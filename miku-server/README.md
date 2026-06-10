# ClaudeDeck Local Miku Voice Server

This folder contains an optional local voice server for ClaudeDeck's custom TTS engine. It exposes an OpenAI-compatible `/v1/audio/speech` endpoint and turns text into speech with this pipeline:

```text
edge-tts base voice -> RVC voice conversion -> MP3 response
```

The base Edge-TTS voice provides pronunciation and language coverage, including Thai and English. RVC then converts the timbre toward a community Miku-style voice model.

## Important Notes

- This is optional. ClaudeDeck works without this server.
- It is resource-heavy. An NVIDIA GPU is strongly recommended.
- CPU mode can work, but a single sentence may take several seconds.
- Only RVC v2 models are supported.
- Community voice models may have their own usage rules. Keep this for personal, non-commercial experiments unless you have the rights to do otherwise.

## Requirements

- Windows
- Python 3.10-3.13
- ffmpeg on PATH
- A compatible RVC v2 `.pth` model
- Optional `.index` file for better voice quality
- Recommended: NVIDIA GPU with CUDA support

Install ffmpeg with winget:

```bat
winget install Gyan.FFmpeg
```

## Model Setup

Download a community Hatsune Miku RVC v2 model. You need a `.pth` file, and ideally a matching `.index` file.

Common places to search:

- voice-models.com
- Hugging Face

Put the files anywhere under `miku-server/models/`. The server discovers models recursively:

```text
miku-server/models/MikuAI/MikuAI.pth
miku-server/models/MikuAI/added_index_file_v2.index
```

## Run

From this folder:

```bat
run.bat
```

The script creates a virtual environment, installs dependencies, installs PyTorch, and starts the server at:

```text
http://127.0.0.1:5050
```

First launch can be slow because it may download PyTorch, ContentVec, and the RMVPE pitch model.

## CPU Mode

CPU mode is slower, but useful for testing:

```bat
set RVC_DEVICE=cpu
run.bat
```

## ClaudeDeck Settings

In ClaudeDeck:

1. Open Settings.
2. Choose the Custom or Miku TTS engine.
3. Set server URL to `http://127.0.0.1:5050`.
4. Set voice to `miku`.
5. Set model to `tts-1`.
6. Press Test.

The server accepts the OpenAI-style request shape, but the `voice` value is mostly a compatibility field.

## Tuning

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `MIKU_MODEL` | first `.pth` under `models/` | RVC model path |
| `MIKU_INDEX` | first `.index` under `models/` | Optional retrieval index |
| `BASE_VOICE_TH` | `th-TH-PremwadeeNeural` | Thai base TTS voice |
| `BASE_VOICE_EN` | `en-US-AnaNeural` | English base TTS voice |
| `RVC_PITCH_TH` | `4` | Thai pitch shift in semitones |
| `RVC_PITCH_EN` | `3` | English pitch shift in semitones |
| `RVC_INDEX_RATE` | `0.5` | Index influence, from 0 to 1 |
| `RVC_DEVICE` | auto | `cuda:0` or `cpu` |
| `RVC_HALF` | `0` | Set `1` for fp16 on GPU |

Thai and English use separate defaults because the base voices sit in different pitch ranges.

## Benchmarking

After setup, you can measure latency from this folder:

```bat
.venv\Scripts\python.exe _bench.py
```

The helper reports cold and warm conversion timing for short and long Thai/English examples.

## How It Works

- `server.py` hosts the HTTP endpoint and language-aware synthesis settings.
- `rvc_infer.py` wraps the RVC conversion flow.
- `rvc/` contains vendored RVC inference code.
- ContentVec is loaded through Hugging Face `transformers` instead of `fairseq`, which keeps setup friendlier on Python 3.12 and 3.13.

## Troubleshooting

- No model found: put a `.pth` file under `miku-server/models/` or set `MIKU_MODEL`.
- ffmpeg error: install ffmpeg and restart the terminal so PATH refreshes.
- Very slow output: confirm CUDA PyTorch is installed and `RVC_DEVICE` is not set to `cpu`.
- Unsupported model: use an RVC v2 model.
