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
import glob
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
BASE_VOICE = os.environ.get("BASE_VOICE", "th-TH-PremwadeeNeural")  # base TTS = language source
DEVICE = os.environ.get("RVC_DEVICE")                              # None -> auto (cuda else cpu)
PITCH = int(os.environ.get("RVC_PITCH", "6"))                      # semitones up → Miku brightness
INDEX_RATE = float(os.environ.get("RVC_INDEX_RATE", "0.5"))
USE_HALF = os.environ.get("RVC_HALF", "0") in ("1", "true", "True")
PORT = int(os.environ.get("PORT", "5050"))

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
    logger.info("Model=%s  Index=%s  BaseVoice=%s  Pitch=%s",
                MODEL_PATH, INDEX_PATH or "(none)", BASE_VOICE, PITCH)
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
    with tempfile.TemporaryDirectory() as d:
        base_mp3 = os.path.join(d, "base.mp3")
        # 1) base TTS (edge-tts is async; this runs in a worker thread)
        asyncio.run(edge_tts.Communicate(text, BASE_VOICE).save(base_mp3))
        audio16k = _mp3_to_16k_mono(base_mp3)
        # 2) RVC convert → Miku timbre
        out, sr = _engine.convert(audio16k, f0_up_key=PITCH, index_rate=INDEX_RATE)
        # 3) → mp3
        return _int16_to_mp3(out, sr)


@app.get("/v1/health")
def health():
    return {
        "status": "ok",
        "ready": _engine is not None,
        "error": _engine_error,
        "model": MODEL_PATH,
        "base_voice": BASE_VOICE,
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
