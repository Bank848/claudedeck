"""
ClaudeDeck — local Miku voice server (fairseq-free).

Pipeline:  text → edge-tts (base voice, any language incl. Thai)
                → RVC voice conversion (Miku timbre, community .pth, no fairseq)
                → MP3, served via an OpenAI-compatible /v1/audio/speech endpoint.

ClaudeDeck's "Custom (Miku)" engine talks to this directly:
  Settings → Voice output engine → Custom (Miku)
    Server URL: http://127.0.0.1:5050
    Voice:      miku   (any value; this server ignores it)

The heavy RVC model code is vendored under ./rvc (MIT, RVC-Project) and runs the
content encoder through HuggingFace transformers instead of fairseq, so it works
on modern Python (3.12/3.13) with no special interpreter. An NVIDIA GPU is
strongly recommended; CPU works but is slow. See README.md.
"""

import os
import re
import glob
import time
import asyncio
import hashlib
import tempfile
import logging
import threading
import traceback

import numpy as np
import edge_tts
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse
from pydub import AudioSegment  # needs ffmpeg on PATH

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("miku.server")


# ── Config (env-overridable) ─────────────────────────────────────────────────
def _find(pattern: str, fallback: str) -> str:
    """Auto-discover a model file anywhere under models/ (e.g. models/MikuAI/foo.pth)."""
    if os.path.exists(fallback):
        return fallback
    hits = sorted(glob.glob(os.path.join("models", "**", pattern), recursive=True))
    # ignore our own downloaded pitch model
    hits = [h for h in hits if os.path.basename(h).lower() != "rmvpe.pt"]
    return hits[0] if hits else fallback


MODEL_PATH = os.environ.get("MIKU_MODEL") or _find("*.pth", "models/miku.pth")
INDEX_PATH = os.environ.get("MIKU_INDEX") or _find("*.index", "models/miku.index")
DEVICE = os.environ.get("RVC_DEVICE")                              # None -> auto (cuda else cpu)
USE_HALF = os.environ.get("RVC_HALF", "0") in ("1", "true", "True")
PORT = int(os.environ.get("PORT", "5050"))

# Shared knobs.
INDEX_RATE = float(os.environ.get("RVC_INDEX_RATE", "0.5"))
# base TTS speaking rate (edge-tts SSML). Slowing it (e.g. "-10%") gives the RVC
# more frames per phoneme → clearer words. "" / "+0%" = natural speed.
BASE_RATE = os.environ.get("RVC_BASE_RATE", "-10%")
# RVC volume-envelope mix: 0.0 keeps the base TTS loudness contour (matches the
# hand-tuned best-so-far `miku_rmsp00.mp3`); 1.0 follows the Miku model's own
# envelope. The old server didn't pass this at all → RVC's default leaked through
# and the live voice drifted from the tuned reference. Pin it to 0.0 by default.
RVC_RMS_MIX = float(os.environ.get("RVC_RMS_MIX", "0.0"))

# Disk cache of rendered MP3s, keyed by (text + every knob that affects output).
# Repeated phrases (status lines, greetings) skip the whole edge-tts + RVC
# pipeline and return instantly — the heavy stages only ever run once per unique
# (text, settings) pair. Persistent across restarts so warm-up cost is paid once.
CACHE_DIR = os.environ.get("MIKU_CACHE_DIR") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".cache"
)

# Per-language voice tuning (A/B-verified by ear on MikuAI v2). Both languages now use
# an English-base multilingual edge-tts voice (Ava) — it reads Thai clearly and far more
# naturally than the th-TH "assistant/news-reader" neural voices, and being English-base
# it already sits near the Miku-alto F0 zone, so Thai no longer needs a big pitch offset.
# We keep the base voice at +0Hz (no edge-tts pitch) and do ALL youthening at the RVC
# stage — pre-pitching the base then pitching again in RVC stacks artifacts.
# Thai is tonal → a larger filter_radius steadies the tones (less warble); English uses a
# lower protect for crisper consonants. Override any field via the matching env var.
#   protect 0–0.5: lower keeps more clear original consonants (0.5 disables it).
#   pitch: semitones up from the base voice.   filter: median window on the pitch.
LANG = {
    "th": {
        # Premwadee (th-TH female neural) is the base the best-so-far `miku_rmsp00.mp3`
        # was tuned on. Override with BASE_VOICE_TH=en-US-AvaMultilingualNeural to try
        # the multilingual-English base again (reads Thai smoothly but a different timbre).
        "voice":   os.environ.get("BASE_VOICE_TH") or os.environ.get("BASE_VOICE", "th-TH-PremwadeeNeural"),
        # +4 chosen by ear over the +3 "rmsp00" reference — +3 sat in normal-adult-female
        # range and read "ทุ้ม/heavy"; +4 nudges toward Miku's brighter timbre without the
        # smear that higher offsets introduce on this base+model. Override via RVC_PITCH_TH.
        "pitch":   int(os.environ.get("RVC_PITCH_TH", "4")),
        "protect": float(os.environ.get("RVC_PROTECT_TH", "0.33")),
        "filter":  int(os.environ.get("RVC_FILTER_TH", "5")),
    },
    "en": {
        "voice":   os.environ.get("BASE_VOICE_EN", "en-US-AnaNeural"),
        "pitch":   int(os.environ.get("RVC_PITCH_EN", "3")),
        "protect": float(os.environ.get("RVC_PROTECT_EN", "0.2")),
        "filter":  int(os.environ.get("RVC_FILTER_EN", "3")),
    },
}
_THAI_RE = re.compile(r"[฀-๿]")


def _lang_of(text: str) -> str:
    """Any Thai character → Thai voice config; otherwise English."""
    return "th" if _THAI_RE.search(text) else "en"

app = FastAPI(title="ClaudeDeck Miku TTS")

# Engine is loaded in the background so the port binds immediately and the app
# sees the server as "running" while the (first-run) model downloads stream to log.
_engine = None
_engine_error: str | None = None
_engine_lock = threading.Lock()


def _load_engine() -> None:
    global _engine, _engine_error
    try:
        from rvc_infer import MikuRVC

        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"No RVC model found. Put a Miku .pth under models/ (looked for {MODEL_PATH})."
            )
        eng = MikuRVC(MODEL_PATH, INDEX_PATH, device=DEVICE, is_half=USE_HALF)
        with _engine_lock:
            _engine = eng
        logger.info("Miku engine ready ✓")
    except Exception:
        _engine_error = traceback.format_exc()
        logger.error("Engine failed to load:\n%s", _engine_error)


@app.on_event("startup")
def _startup() -> None:
    logger.info("Model=%s  Index=%s  BaseRate=%s", MODEL_PATH,
                INDEX_PATH or "(none)", BASE_RATE or "+0%")
    for lang, c in LANG.items():
        logger.info("  [%s] voice=%s pitch=%s protect=%s filter=%s",
                    lang, c["voice"], c["pitch"], c["protect"], c["filter"])
    # Load the engine in the MAIN thread (synchronous, blocking startup).
    #
    # The heavy init touches CUDA + faiss (which pulls in its own OpenMP runtime).
    # When that ran inside a daemon Thread alongside uvicorn's asyncio event loop
    # on the main thread, the process reliably segfaulted (exit 139) the instant
    # the loader thread finished — torch/CUDA + OpenMP do not survive being
    # initialized off the main thread while another runtime owns the main loop.
    # Loading synchronously here costs ~18 s of startup latency (the client sees
    # connection-refused until ready, and ClaudeDeck already tracks readiness via
    # the process, not HTTP) but the process stays alive and serves requests.
    _load_engine()


def _mp3_to_16k_mono(path: str) -> np.ndarray:
    # High-quality 24k→16k resample (soxr_hq) preserves Thai consonant clarity far
    # better than pydub's crude set_frame_rate; librosa.load uses soxr by default.
    import librosa

    wav = librosa.load(path, sr=16000, mono=True, res_type="soxr_hq")[0]
    return wav.astype(np.float32)


def _int16_to_mp3(audio: np.ndarray, sr: int) -> bytes:
    if audio.dtype != np.int16:
        audio = audio.astype(np.int16)
    seg = AudioSegment(audio.tobytes(), frame_rate=sr, sample_width=2, channels=1)
    return seg.export(format="mp3").read()


def _edge_save(text: str, voice: str, out_path: str, kwargs: dict,
               attempts: int = 3) -> None:
    """Run edge-tts with retries on the transient NoAudioReceived failure."""
    last = None
    for i in range(attempts):
        try:
            asyncio.run(edge_tts.Communicate(text, voice, **kwargs).save(out_path))
            if os.path.getsize(out_path) > 0:
                return
            last = RuntimeError("edge-tts wrote an empty file")
        except edge_tts.exceptions.NoAudioReceived as e:
            last = e
            logger.warning("edge-tts NoAudioReceived (attempt %d/%d), retrying…",
                           i + 1, attempts)
        time.sleep(0.6 * (i + 1))
    raise last if last else RuntimeError("edge-tts failed")


def _cache_path(text: str, lang: str, cfg: dict) -> str:
    """Stable path for this exact (text, settings) render. Any knob change → new key."""
    key = "|".join(str(p) for p in (
        text, lang, cfg["voice"], cfg["pitch"], cfg["protect"], cfg["filter"],
        INDEX_RATE, RVC_RMS_MIX, BASE_RATE, MODEL_PATH,
    ))
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return os.path.join(CACHE_DIR, f"{digest}.mp3")


def _cache_get(path: str) -> bytes | None:
    try:
        with open(path, "rb") as f:
            data = f.read()
        return data if data else None
    except OSError:
        return None


def _cache_put(path: str, mp3: bytes) -> None:
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        # Write to a temp file then atomically replace, so a crash mid-write never
        # leaves a truncated cache entry that would play as a broken clip.
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "wb") as f:
            f.write(mp3)
        os.replace(tmp, path)
    except OSError as e:
        logger.warning("cache write failed (%s) — serving without cache", e)


def synth(text: str) -> bytes:
    lang = _lang_of(text)
    cfg = LANG[lang]
    cache_path = _cache_path(text, lang, cfg)
    cached = _cache_get(cache_path)
    if cached is not None:
        logger.info("synth[%s] %d chars → cache HIT (0.00s)", lang, len(text))
        return cached
    with tempfile.TemporaryDirectory() as d:
        base_mp3 = os.path.join(d, "base.mp3")
        # 1) base TTS (edge-tts is async; this runs in a worker thread). Voice is
        #    picked per detected language; slowing the base rate improves clarity.
        kwargs = {"rate": BASE_RATE} if BASE_RATE and BASE_RATE != "+0%" else {}
        t0 = time.perf_counter()
        # edge-tts intermittently returns NoAudioReceived (Microsoft endpoint
        # hiccup / token rotation). A bare failure makes ClaudeDeck fall back to
        # the system voice, which reads as "Miku server does nothing". Retry a few
        # times before giving up so transient blips don't surface to the user.
        _edge_save(text, cfg["voice"], base_mp3, kwargs)
        audio16k = _mp3_to_16k_mono(base_mp3)
        t1 = time.perf_counter()
        # 2) RVC convert → Miku timbre (per-language pitch/protect/filter)
        out, sr = _engine.convert(audio16k, f0_up_key=cfg["pitch"],
                                  index_rate=INDEX_RATE, protect=cfg["protect"],
                                  filter_radius=cfg["filter"], rms_mix_rate=RVC_RMS_MIX)
        t2 = time.perf_counter()
        # 3) → mp3
        mp3 = _int16_to_mp3(out, sr)
        _cache_put(cache_path, mp3)
        t3 = time.perf_counter()
        # Latency breakdown. Synthesis is non-streaming, so total ≈ time-to-first-byte
        # the client experiences. RTF<1 means we render faster than realtime.
        audio_s = len(out) / sr if sr else 0.0
        total = t3 - t0
        logger.info(
            "synth[%s] %d chars → %.2fs audio | edge=%.2fs rvc=%.2fs mp3=%.2fs "
            "total=%.2fs (TTFB) RTF=%.2f",
            lang, len(text), audio_s, t1 - t0, t2 - t1, t3 - t2,
            total, (total / audio_s) if audio_s else 0.0,
        )
        return mp3


@app.get("/health")
@app.get("/v1/health")
def health():
    return {
        "status": "ok",
        "ready": _engine is not None,
        "error": _engine_error,
        "model": MODEL_PATH,
        "base_rate": BASE_RATE or "+0%",
        "lang": LANG,
    }


# ── Prewarm ──────────────────────────────────────────────────────────────────
# The renderer owns the finite list of fixed assistant phrases (status lines,
# view names, greeting, mode/effort confirmations). On server-ready it POSTs them
# here so we render each ONCE in the background — turning the user's first live
# use of each phrase into a 0.00s cache HIT instead of a cold edge-tts + RVC
# render. The first convert here also absorbs the one-time CUDA/cuDNN warm-up.
_prewarm_lock = threading.Lock()
_prewarm_active = False


def _run_prewarm(phrases: list[str]) -> None:
    """Render each phrase one at a time (synth() skips already-cached ones) so we
    never fight the live speech path for the GPU. Per-phrase failures are logged
    and skipped — a transient edge-tts blip must not abort the whole batch."""
    global _prewarm_active
    done = 0
    try:
        for p in phrases:
            text = (p or "").strip()
            if not text:
                continue
            try:
                synth(text)
                done += 1
            except Exception:
                logger.warning("prewarm failed for %r:\n%s", text, traceback.format_exc())
    finally:
        with _prewarm_lock:
            _prewarm_active = False
        logger.info("prewarm batch done (%d/%d rendered)", done, len(phrases))


@app.post("/v1/prewarm")
async def prewarm(req: Request):
    if _engine is None:
        msg = _engine_error or "Model is still loading…"
        return JSONResponse({"error": msg}, status_code=503)
    body = await req.json()
    raw = body.get("phrases") or []
    phrases = [p.strip() for p in raw if isinstance(p, str) and p.strip()]
    if not phrases:
        return JSONResponse({"status": "empty", "warming": 0})
    # Re-entry guard: a prewarm already in flight just keeps going — don't stack
    # a second pass that would double the GPU load for no benefit.
    global _prewarm_active
    with _prewarm_lock:
        if _prewarm_active:
            return JSONResponse({"status": "already", "warming": 0})
        _prewarm_active = True
    threading.Thread(
        target=_run_prewarm, args=(phrases,), daemon=True, name="miku-prewarm"
    ).start()
    logger.info("prewarm started: %d phrase(s)", len(phrases))
    return JSONResponse({"status": "warming", "warming": len(phrases)}, status_code=202)


@app.post("/v1/audio/speech")
async def speech(req: Request):
    body = await req.json()
    text = (body.get("input") or "").strip()
    if not text:
        return Response(status_code=400)
    if _engine is None:
        msg = _engine_error or "Model is still loading (first run downloads ~400 MB)…"
        return JSONResponse({"error": msg}, status_code=503)
    try:
        mp3 = await asyncio.to_thread(synth, text)
    except Exception:
        tb = traceback.format_exc()
        logger.error("Synthesis failed:\n%s", tb)
        return JSONResponse({"error": tb}, status_code=500)
    return Response(content=mp3, media_type="audio/mpeg")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT)
