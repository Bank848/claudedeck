# ClaudeDeck — Local Miku Voice Server

Run a **real Hatsune Miku voice** locally and plug it into ClaudeDeck's
**Custom (Miku)** TTS engine. Pipeline: `edge-tts` (base voice, picks the
language — incl. Thai) → **RVC** voice conversion (Miku timbre) → MP3, served on
an OpenAI-compatible `/v1/audio/speech` endpoint.

> ⚠️ Resource-heavy. Needs an **NVIDIA GPU** for snappy results (CPU works but is
> slow — a sentence can take several seconds). Expect some delay.

## 1. Get a Miku RVC model (free, community)
Download a **Hatsune Miku RVC v2** model — a `.pth` (required) and ideally a
`.index` (better quality). Free sources:
- https://voice-models.com (search "Hatsune Miku")
- HuggingFace (search "Hatsune Miku RVC")

Put them here:
```
miku-server/models/miku.pth
miku-server/models/miku.index   (optional)
```

## 2. Prereqs
- **Python 3.10–3.11**
- **ffmpeg** on PATH (for MP3) — `winget install Gyan.FFmpeg`
- **PyTorch (CUDA build)** matching your GPU — see https://pytorch.org
  (e.g. `pip install torch --index-url https://download.pytorch.org/whl/cu121`)

## 3. Run
```
run.bat
```
(creates a venv, installs deps, starts the server on `http://127.0.0.1:5050`)

No GPU? Set `RVC_DEVICE=cpu` before running (slow).

## 4. Point ClaudeDeck at it
In ClaudeDeck → **Settings → Voice output engine → Custom (Miku)**:
- **Server URL:** `http://127.0.0.1:5050`
- **Voice:** `miku` (any value; the server ignores it)
- **Model:** `tts-1`
- Press **Test** — you should hear Miku.

## Tuning (env vars)
| Var | Default | What |
|-----|---------|------|
| `MIKU_MODEL` | `models/miku.pth` | RVC model path |
| `MIKU_INDEX` | `models/miku.index` | optional index |
| `BASE_VOICE` | `th-TH-PremwadeeNeural` | base TTS = **language** (use `en-US-AnaNeural` for English) |
| `RVC_PITCH` | `6` | semitones up (higher = brighter/Miku-er) |
| `RVC_DEVICE` | `cuda:0` | `cpu` if no GPU |

## Notes
- Miku is owned by Crypton Future Media. This is for **personal, non-commercial**
  use with community models — don't ship/sell the model.
- This is a **starter** script; tweak `PITCH` / `BASE_VOICE` and the RVC params in
  `server.py` to taste.
