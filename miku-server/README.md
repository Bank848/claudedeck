# ClaudeDeck — Local Miku Voice Server

Run a **real Hatsune Miku voice** locally and plug it into ClaudeDeck's
**Custom (Miku)** TTS engine. Pipeline: `edge-tts` (base voice, picks the
language — incl. Thai) → **RVC** voice conversion (Miku timbre) → MP3, served on
an OpenAI-compatible `/v1/audio/speech` endpoint.

> ⚠️ Resource-heavy. Needs an **NVIDIA GPU** for snappy results (CPU works but is
> slow — a sentence can take several seconds). Expect some delay.

**fairseq-free.** The RVC model code is vendored under `rvc/` (MIT, from
[RVC-Project](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI))
but the content encoder runs through HuggingFace `transformers` (ContentVec)
instead of `fairseq` — so it installs on **Python 3.12/3.13** with no special
interpreter and no 2022 build-chain. **RVC v2 models only.** First run downloads
ContentVec + the `rmvpe` pitch model (~400 MB) automatically.

## 1. Get a Miku RVC model (free, community)
Download a **Hatsune Miku RVC v2** model — a `.pth` (required) and ideally a
`.index` (better quality). Free sources:
- https://voice-models.com (search "Hatsune Miku")
- HuggingFace (search "Hatsune Miku RVC")

Put them anywhere under `models/` — the server auto-discovers `.pth` / `.index`
recursively, so a downloaded folder works as-is:
```
miku-server/models/MikuAI/MikuAI.pth
miku-server/models/MikuAI/added_..._v2.index   (optional, better quality)
```

## 2. Prereqs
- **Python 3.10–3.13** (official CPython; `run.bat` picks it via the `py` launcher)
- **ffmpeg** on PATH (for MP3) — `winget install Gyan.FFmpeg`
- PyTorch is installed automatically by `run.bat` (CUDA `cu124` build). No GPU?
  Edit `run.bat` to use `--index-url https://download.pytorch.org/whl/cpu`.

## 3. Run
```
run.bat
```
Creates a venv, installs PyTorch + deps, starts the server on
`http://127.0.0.1:5050`. **First run is slow** — it downloads PyTorch (~2.5 GB)
then ContentVec + rmvpe (~400 MB). The server binds the port immediately and
loads the model in the background; watch the log for `Miku engine ready ✓`.

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
| `MIKU_MODEL` | auto (first `.pth` under `models/`) | RVC model path |
| `MIKU_INDEX` | auto (first `.index` under `models/`) | optional index |
| `BASE_VOICE` | `th-TH-PremwadeeNeural` | base TTS = **language** (use `en-US-AnaNeural` for English) |
| `RVC_PITCH` | `6` | semitones up (higher = brighter/Miku-er) |
| `RVC_INDEX_RATE` | `0.5` | how much the `.index` steers timbre (0–1) |
| `RVC_DEVICE` | auto (`cuda:0` else `cpu`) | force `cpu` / `cuda:0` |
| `RVC_HALF` | `0` | `1` = fp16 on GPU (faster, slightly riskier) |

## Notes
- Miku is owned by Crypton Future Media. This is for **personal, non-commercial**
  use with community models — don't ship/sell the model.
- **RVC v2 only.** v1 models (256-dim) aren't supported by the fairseq-free
  ContentVec path; the server will say so on startup.
- Tweak `RVC_PITCH` / `BASE_VOICE` to taste. The vendored RVC code lives in
  `rvc/`; the glue is `rvc_infer.py` + `server.py`.
