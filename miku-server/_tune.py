"""
A/B tuning harness for Miku articulation (run once, by hand).

Loads the RVC engine a single time and renders the same Thai + English sentence
through several (protect, base_rate) combos so you can listen and pick the clearest
one that still sounds like Miku. Pitch stays at 6 (the preferred "most-Miku" sound).

Run:
    .venv\\Scripts\\python.exe _tune.py

Outputs miku_<variant>_<lang>.mp3 in this folder. Lower `protect` keeps more of the
clear original consonants; "-10%" base rate gives more frames per phoneme. After you
pick a winner, set RVC_PROTECT / RVC_BASE_RATE defaults in server.py to match.
"""

import os
import asyncio
import tempfile

import numpy as np
import edge_tts
from pydub import AudioSegment

from rvc_infer import MikuRVC

BASE_VOICE_TH = os.environ.get("BASE_VOICE", "th-TH-PremwadeeNeural")
BASE_VOICE_EN = "en-US-AnaNeural"
PITCH = 6
INDEX_RATE = 0.5

TEXT_TH = "สวัสดีค่ะ วันนี้อากาศดีมากเลยนะคะ ฉันชื่อมิกุ ยินดีที่ได้รู้จักค่ะ"
TEXT_EN = "Hi there! I'm Miku. Let me read your code review out loud so you can keep your eyes off the screen."

# variant label -> (protect, base_rate)
VARIANTS = {
    "A_baseline":   (0.33, "+0%"),   # current default (what user liked, but mushy)
    "B_p40_slow":   (0.40, "-10%"),  # the user's suggested direction
    "C_p20_slow":   (0.20, "-10%"),  # MORE original consonant kept = clearer (likely winner)
    "D_slow_only":  (0.33, "-10%"),  # isolate the slow-rate effect alone
}


def _mp3_to_16k_mono(path: str) -> np.ndarray:
    seg = AudioSegment.from_file(path).set_channels(1).set_frame_rate(16000)
    samples = np.array(seg.get_array_of_samples()).astype(np.float32)
    peak = float(1 << (8 * seg.sample_width - 1))
    return samples / peak


def _int16_to_mp3(audio: np.ndarray, sr: int, out_path: str) -> None:
    if audio.dtype != np.int16:
        audio = audio.astype(np.int16)
    seg = AudioSegment(audio.tobytes(), frame_rate=sr, sample_width=2, channels=1)
    seg.export(out_path, format="mp3")


def render(engine: MikuRVC, text: str, voice: str, rate: str, protect: float,
           out_path: str, pitch: int = PITCH, index_rate: float = INDEX_RATE,
           filter_radius: int = 3) -> None:
    with tempfile.TemporaryDirectory() as d:
        base_mp3 = os.path.join(d, "base.mp3")
        kwargs = {"rate": rate} if rate and rate != "+0%" else {}
        asyncio.run(edge_tts.Communicate(text, voice, **kwargs).save(base_mp3))
        audio16k = _mp3_to_16k_mono(base_mp3)
        out, sr = engine.convert(audio16k, f0_up_key=pitch, index_rate=index_rate,
                                 protect=protect, filter_radius=filter_radius)
        _int16_to_mp3(out, sr, out_path)
    print(f"  wrote {out_path}  (pitch={pitch}, protect={protect}, rate={rate}, "
          f"index={index_rate}, fr={filter_radius})")


def main() -> None:
    print("Loading Miku engine (one time)…")
    model = os.environ.get("MIKU_MODEL")
    index = os.environ.get("MIKU_INDEX", "")
    if not model:
        import glob
        hits = [h for h in sorted(glob.glob(os.path.join("models", "**", "*.pth"), recursive=True))
                if os.path.basename(h).lower() != "rmvpe.pt"]
        model = hits[0] if hits else "models/miku.pth"
        idx = sorted(glob.glob(os.path.join("models", "**", "*.index"), recursive=True))
        index = idx[0] if idx else ""
    print(f"  model={model}\n  index={index or '(none)'}")
    engine = MikuRVC(model, index)

    for lang, (text, voice) in {
        "th": (TEXT_TH, BASE_VOICE_TH),
        "en": (TEXT_EN, BASE_VOICE_EN),
    }.items():
        print(f"[{lang}]")
        for label, (protect, rate) in VARIANTS.items():
            render(engine, text, voice, rate, protect, f"miku_{label}_{lang}.mp3")

    print("\nDone. Listen and tell me the winning variant + language.")


if __name__ == "__main__":
    main()
