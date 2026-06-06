"""
Thai refinement sweep — the Thai winner D (pitch 6, protect 0.33, rate -10%)
still sounds slightly "แปลก". Hold that base and probe the two knobs most likely
to be the cause:

  index_rate    — higher locks the Miku timbre steadier (less wobble), 0.5 → 0.75
  filter_radius — higher steadies the pitch track, smoothing Thai tone warble, 3 → 5

Run:  .venv\\Scripts\\python.exe _tune_th.py
Then: .venv\\Scripts\\python.exe _analyze.py
"""

import os
import sys
import glob

from rvc_infer import MikuRVC
from _tune import render

VOICE = os.environ.get("BASE_VOICE", "th-TH-PremwadeeNeural")
TEXT = "สวัสดีค่ะ วันนี้อากาศดีมากเลยนะคะ ฉันชื่อมิกุ ยินดีที่ได้รู้จักค่ะ"
PROTECT = 0.33      # Thai winner D
PITCH = 6

# label -> (rate, index_rate, filter_radius)
VARIANTS = {
    "T1_ref":        ("-10%", 0.50, 3),   # = winner D, reference
    "T2_index75":    ("-10%", 0.75, 3),   # stronger Miku timbre lock
    "T3_fr5":        ("-10%", 0.50, 5),   # steadier pitch (tone warble fix)
    "T4_index75_fr5":("-10%", 0.75, 5),   # both
    "T5_slow15":     ("-15%", 0.50, 3),   # even slower base
}


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

    pitches = [int(a) for a in sys.argv[1:]]
    if pitches:
        # pitch sweep on the chosen T3 config (index 0.5, filter 5)
        for p in pitches:
            render(engine, TEXT, VOICE, "-10%", PROTECT, f"miku_th_pitch{p}.mp3",
                   pitch=p, index_rate=0.50, filter_radius=5)
        print("\nDone. Listen to miku_th_pitch*.mp3 — pick the pitch you like.")
        return

    for label, (rate, ir, fr) in VARIANTS.items():
        render(engine, TEXT, VOICE, rate, PROTECT, f"miku_{label}_th.mp3",
               pitch=PITCH, index_rate=ir, filter_radius=fr)

    print("\nDone. Listen to miku_T*_th.mp3 — pick the steadiest/most natural one.")


if __name__ == "__main__":
    main()
