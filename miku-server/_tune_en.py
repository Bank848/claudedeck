"""
English pitch sweep — tame the "แหลม" (shrill) English voice.

The base English voice (Ana) sits ~6 semitones higher than the Thai base
(Premwadee), so at the shared pitch=6 the English F0 lands ~390 Hz vs ~277 Hz
for Thai. This renders English at lower pitches so its F0 drops into the same
pleasant ~280–310 Hz Miku-alto zone the Thai voice already hits.

Run:  .venv\\Scripts\\python.exe _tune_en.py
Then: .venv\\Scripts\\python.exe _analyze.py   (compare F0 to the ~277 Hz Thai target)
"""

import os
import sys
import glob

from rvc_infer import MikuRVC
from _tune import render

VOICE = "en-US-AnaNeural"
TEXT = "Hi there! I'm Miku. Let me read your code review out loud so you can keep your eyes off the screen."
PROTECT = 0.20      # clearest consonants (winner direction from Thai A/B)
RATE = "-10%"
PITCHES = [0, 2, 4]  # 4 ≈ ~310 Hz, 2 ≈ ~275 Hz, 0 ≈ ~245 Hz (estimated)


def main() -> None:
    model = os.environ.get("MIKU_MODEL")
    index = os.environ.get("MIKU_INDEX", "")
    if not model:
        hits = [h for h in sorted(glob.glob(os.path.join("models", "**", "*.pth"), recursive=True))
                if os.path.basename(h).lower() != "rmvpe.pt"]
        model = hits[0] if hits else "models/miku.pth"
        idx = sorted(glob.glob(os.path.join("models", "**", "*.index"), recursive=True))
        index = idx[0] if idx else ""
    print(f"Loading engine… model={model}")
    engine = MikuRVC(model, index)

    pitches = [int(a) for a in sys.argv[1:]] or PITCHES
    for p in pitches:
        render(engine, TEXT, VOICE, RATE, PROTECT, f"miku_en_pitch{p}.mp3", pitch=p)

    print("\nDone. Listen to miku_en_pitch{0,2,4}.mp3 — pick the least shrill that still feels like Miku.")


if __name__ == "__main__":
    main()
