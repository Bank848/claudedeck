"""
ClaudeDeck — local Miku voice server (starter).

Pipeline:  text → edge-tts (base voice, any language incl. Thai)
                → RVC voice conversion (Miku timbre, from a community .pth model)
                → MP3, served via an OpenAI-compatible /v1/audio/speech endpoint.

ClaudeDeck's "Custom (Miku)" engine talks to this directly:
  Settings → Voice output engine → Custom (Miku)
    Server URL: http://127.0.0.1:5050
    Voice:      miku   (any value; this server ignores it)

Requires an NVIDIA GPU for reasonable speed (CPU works but is slow).
See README.md for setup. This is a starter — tweak PITCH / BASE_VOICE to taste.
"""

import os
import glob
import asyncio
import tempfile

import edge_tts
from fastapi import FastAPI, Request
from fastapi.responses import Response
from pydub import AudioSegment  # needs ffmpeg on PATH
from rvc_python.infer import RVCInference

# ── Config (env-overridable) ─────────────────────────────────────────────────
def _find(pattern: str, fallback: str) -> str:
    """Auto-discover a model file anywhere under models/ (e.g. models/MikuAI/foo.pth)."""
    if os.path.exists(fallback):
        return fallback
    hits = sorted(glob.glob(os.path.join("models", "**", pattern), recursive=True))
    return hits[0] if hits else fallback

MODEL_PATH = os.environ.get("MIKU_MODEL") or _find("*.pth", "models/miku.pth")
INDEX_PATH = os.environ.get("MIKU_INDEX") or _find("*.index", "models/miku.index")
BASE_VOICE = os.environ.get("BASE_VOICE", "th-TH-PremwadeeNeural")  # base TTS = language source
DEVICE = os.environ.get("RVC_DEVICE", "cuda:0")                   # 'cpu' if no GPU
PITCH = int(os.environ.get("RVC_PITCH", "6"))                     # semitones up → Miku brightness
PORT = int(os.environ.get("PORT", "5050"))

app = FastAPI(title="ClaudeDeck Miku TTS")

rvc = RVCInference(device=DEVICE)
rvc.load_model(MODEL_PATH)
# Best-effort param set across rvc-python versions.
try:
    rvc.set_params(f0up_key=PITCH, f0method="rmvpe")
except Exception:
    pass
if os.path.exists(INDEX_PATH):
    try:
        rvc.set_params(index_path=INDEX_PATH, index_rate=0.75)
    except Exception:
        pass


def synth(text: str) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        base_mp3 = os.path.join(d, "base.mp3")
        base_wav = os.path.join(d, "base.wav")
        out_wav = os.path.join(d, "out.wav")

        # 1) base TTS (edge-tts is async)
        asyncio.run(edge_tts.Communicate(text, BASE_VOICE).save(base_mp3))
        AudioSegment.from_file(base_mp3).export(base_wav, format="wav")

        # 2) RVC convert → Miku timbre
        rvc.infer_file(base_wav, out_wav)

        # 3) wav → mp3
        buf = AudioSegment.from_file(out_wav).export(format="mp3")
        return buf.read()


@app.get("/v1/health")
def health():
    return {"status": "ok", "model": MODEL_PATH, "base_voice": BASE_VOICE}


@app.post("/v1/audio/speech")
async def speech(req: Request):
    body = await req.json()
    text = (body.get("input") or "").strip()
    if not text:
        return Response(status_code=400)
    mp3 = await asyncio.to_thread(synth, text)
    return Response(content=mp3, media_type="audio/mpeg")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT)
