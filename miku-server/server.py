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

# Per-language voice tuning (A/B-verified by ear on MikuAI v2). The Thai base voice
# sits ~6 semitones below the English base, so each language gets its own pitch to
# land in the same pleasant Miku-alto F0 zone (~258 Hz). Thai is tonal → a larger
# filter_radius steadies the tones (less warble); English uses a lower protect for
# crisper consonants. Override any field via the matching env var.
#   protect 0–0.5: lower keeps more clear original consonants (0.5 disables it).
#   pitch: semitones up from the base voice.   filter: median window on the pitch.
LANG = {
    "th": {
        "voice":   os.environ.get("BASE_VOICE_TH") or os.environ.get("BASE_VOICE", "th-TH-PremwadeeNeural"),
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
    threading.Thread(target=_load_engine, daemon=True).start()


def _mp3_to_16k_mono(path: str) -> np.ndarray:
    seg = AudioSegment.from_file(path).set_channels(1).set_frame_rate(16000)
    samples = np.array(seg.get_array_of_samples()).astype(np.float32)
    peak = float(1 << (8 * seg.sample_width - 1))
    return samples / peak


def _int16_to_mp3(audio: np.ndarray, sr: int) -> bytes:
    if audio.dtype != np.int16:
        audio = audio.astype(np.int16)
    seg = AudioSegment(audio.tobytes(), frame_rate=sr, sample_width=2, channels=1)
    return seg.export(format="mp3").read()


def synth(text: str) -> bytes:
    lang = _lang_of(text)
    cfg = LANG[lang]
    with tempfile.TemporaryDirectory() as d:
        base_mp3 = os.path.join(d, "base.mp3")
        # 1) base TTS (edge-tts is async; this runs in a worker thread). Voice is
        #    picked per detected language; slowing the base rate improves clarity.
        kwargs = {"rate": BASE_RATE} if BASE_RATE and BASE_RATE != "+0%" else {}
        t0 = time.perf_counter()
        asyncio.run(edge_tts.Communicate(text, cfg["voice"], **kwargs).save(base_mp3))
        audio16k = _mp3_to_16k_mono(base_mp3)
        t1 = time.perf_counter()
        # 2) RVC convert → Miku timbre (per-language pitch/protect/filter)
        out, sr = _engine.convert(audio16k, f0_up_key=cfg["pitch"],
                                  index_rate=INDEX_RATE, protect=cfg["protect"],
                                  filter_radius=cfg["filter"])
        t2 = time.perf_counter()
        # 3) → mp3
        mp3 = _int16_to_mp3(out, sr)
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
