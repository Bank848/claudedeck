"""
rms_mix_rate sweep — hold the pitch3 winner (pitch=3, protect=0.33, index=0.50,
filter_radius=5, Premwadee rate -10%) and only vary rms_mix_rate downward to test
whether lower rms (follow Miku's own loudness envelope) sounds more "Miku".

  rms_mix_rate: 0 = Miku model's own loudness dynamics, 1 = follow base TTS loudness.

Run:  .venv\\Scripts\\python.exe _tune_rms.py
Outputs miku_rms*.mp3 — compare vs _mikudemo/miku_th_rvcpitch3.mp3 (the benchmark).
"""

import os
import glob
import asyncio
import tempfile

import numpy as np
import edge_tts
from pydub import AudioSegment

from rvc_infer import MikuRVC

VOICE = os.environ.get("BASE_VOICE", "th-TH-PremwadeeNeural")
TEXT = "สวัสดีค่ะ วันนี้อากาศดีมากเลยนะคะ ฉันชื่อมิกุ ยินดีที่ได้รู้จักค่ะ"
RATE, PITCH, PROTECT, INDEX, FR = "-10%", 3, 0.33, 0.50, 5
RMS_VALUES = [0.25, 0.15, 0.05, 0.0]  # 0.25 = pitch3 reference


def _mp3_to_16k_mono(path: str) -> np.ndarray:
    # soxr_hq resample (24k→16k) keeps consonants clearer than pydub set_frame_rate.
    import librosa

    return librosa.load(path, sr=16000, mono=True, res_type="soxr_hq")[0].astype(np.float32)


def _int16_to_mp3(audio: np.ndarray, sr: int, out_path: str) -> None:
    if audio.dtype != np.int16:
        audio = audio.astype(np.int16)
    AudioSegment(audio.tobytes(), frame_rate=sr, sample_width=2, channels=1).export(out_path, format="mp3")


def main() -> None:
    model = os.environ.get("MIKU_MODEL")
    index = os.environ.get("MIKU_INDEX", "")
    if not model:
        hits = [h for h in sorted(glob.glob(os.path.join("models", "**", "*.pth"), recursive=True))
                if os.path.basename(h).lower() != "rmvpe.pt"]
        model = hits[0] if hits else "models/miku.pth"
        idx = sorted(glob.glob(os.path.join("models", "**", "*.index"), recursive=True))
        index = idx[0] if idx else ""
    print(f"Loading engine… model={model}\n  index={index or '(none)'}")
    engine = MikuRVC(model, index)

    # Render the base TTS once, reuse for every rms value (true apples-to-apples).
    with tempfile.TemporaryDirectory() as d:
        base_mp3 = os.path.join(d, "base.mp3")
        asyncio.run(edge_tts.Communicate(TEXT, VOICE, rate=RATE).save(base_mp3))
        audio16k = _mp3_to_16k_mono(base_mp3)

        for rms in RMS_VALUES:
            tag = f"{rms:.2f}".replace("0.", "p").replace(".", "")
            out, sr = engine.convert(audio16k, f0_up_key=PITCH, index_rate=INDEX,
                                     protect=PROTECT, filter_radius=FR, rms_mix_rate=rms)
            path = f"miku_rms{tag}.mp3"
            _int16_to_mp3(out, sr, path)
            print(f"  wrote {path}  (rms_mix_rate={rms})")

    print("\nDone. Listen miku_rms*.mp3 — rmsp25 = pitch3 ref; lower = more Miku dynamics.")


if __name__ == "__main__":
    main()
