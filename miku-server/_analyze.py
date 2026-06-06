"""
Objective analysis of the rendered Miku variants — so tuning is data-driven
instead of "listen to all of them every time".

Lightweight metrics (no model download):
  - duration, peak/RMS loudness (dBFS)
  - spectral centroid (Hz)  → brightness; HIGHER = shriller / more "แหลม"
  - spectral rolloff 85%    → where most energy sits
  - HF ratio (>4 kHz / total energy) → sibilance / harshness proxy

Optional intelligibility (pass --asr): transcribe each clip with faster-whisper
and report character error rate vs the known source text. LOWER CER = clearer.
This downloads a Whisper model on first run, so it is opt-in.

Run:
    .venv\\Scripts\\python.exe _analyze.py            # brightness/loudness only
    .venv\\Scripts\\python.exe _analyze.py --asr      # + intelligibility (downloads)
"""

import os
import sys
import glob

import numpy as np
from pydub import AudioSegment

SR = 16000
FRAME = 1024
HOP = 512

# Known source text per language suffix (for the optional --asr CER metric).
SOURCE = {
    "th": "สวัสดีค่ะ วันนี้อากาศดีมากเลยนะคะ ฉันชื่อมิกุ ยินดีที่ได้รู้จักค่ะ",
    "en": "Hi there! I'm Miku. Let me read your code review out loud so you can keep your eyes off the screen.",
}


def load(path: str) -> np.ndarray:
    seg = AudioSegment.from_file(path).set_channels(1).set_frame_rate(SR)
    x = np.array(seg.get_array_of_samples()).astype(np.float32)
    return x / float(1 << (8 * seg.sample_width - 1))


def dbfs(x: np.ndarray) -> float:
    v = float(np.sqrt(np.mean(x ** 2)) + 1e-12)
    return 20 * np.log10(v)


def f0_median(x: np.ndarray) -> float:
    """Median fundamental frequency (Hz) over voiced frames via autocorrelation.

    This is the real "แหลม"/pitch number — how high the voice sits — which the
    spectral centroid (timbre brightness) does not capture once RVC normalises it.
    """
    lo, hi = int(SR / 500), int(SR / 80)        # 80–500 Hz search band
    win = np.hanning(FRAME)
    f0s = []
    for i in range(0, max(1, len(x) - FRAME), HOP):
        frame = x[i:i + FRAME] * win
        if np.sqrt(np.mean(frame ** 2)) < 0.01:  # skip quiet frames
            continue
        ac = np.correlate(frame, frame, "full")[FRAME - 1:]
        if ac[0] <= 0:
            continue
        seg = ac[lo:hi]
        if len(seg) == 0:
            continue
        lag = lo + int(np.argmax(seg))
        if ac[lag] / ac[0] > 0.3:                # confident periodicity only
            f0s.append(SR / lag)
    return float(np.median(f0s)) if f0s else 0.0


def spectral(x: np.ndarray) -> tuple[float, float, float]:
    """Return (centroid Hz, rolloff85 Hz, hf_ratio) averaged over voiced frames."""
    win = np.hanning(FRAME)
    freqs = np.fft.rfftfreq(FRAME, 1.0 / SR)
    cents, rolls, hfs = [], [], []
    for i in range(0, max(1, len(x) - FRAME), HOP):
        frame = x[i:i + FRAME]
        if len(frame) < FRAME:
            break
        mag = np.abs(np.fft.rfft(frame * win))
        e = mag.sum()
        if e < 1e-4:                       # skip silence
            continue
        cents.append(float((freqs * mag).sum() / e))
        cum = np.cumsum(mag)
        rolls.append(float(freqs[np.searchsorted(cum, 0.85 * cum[-1])]))
        hfs.append(float(mag[freqs > 4000].sum() / e))
    if not cents:
        return 0.0, 0.0, 0.0
    return float(np.mean(cents)), float(np.mean(rolls)), float(np.mean(hfs))


def cer(ref: str, hyp: str) -> float:
    """Character error rate (Levenshtein / len) — lower = clearer."""
    ref = "".join(ref.split())
    hyp = "".join(hyp.split())
    n, m = len(ref), len(hyp)
    if n == 0:
        return 0.0 if m == 0 else 1.0
    dp = list(range(m + 1))
    for i in range(1, n + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, m + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (ref[i - 1] != hyp[j - 1]))
            prev = cur
    return dp[m] / n


def main() -> None:
    use_asr = "--asr" in sys.argv
    files = sorted(f for f in glob.glob("miku_*.mp3")
                   if os.path.basename(f) not in ("miku_test.mp3",))
    if not files:
        print("No miku_*.mp3 files here. Run _tune.py first.")
        return

    asr = None
    if use_asr:
        from faster_whisper import WhisperModel
        print("Loading faster-whisper (small, first run downloads ~460 MB)…")
        asr = WhisperModel("small", device="auto", compute_type="int8")

    header = (f"{'file':32} {'dur':>5} {'rms':>7} {'F0':>5} {'centroid':>9} "
              f"{'roll85':>7} {'hf%':>6}")
    if use_asr:
        header += f" {'CER':>6}"
    print(header)
    print("-" * len(header))

    for f in files:
        x = load(f)
        dur = len(x) / SR
        cen, roll, hf = spectral(x)
        row = (f"{f:32} {dur:5.2f} {dbfs(x):7.1f} {f0_median(x):5.0f} {cen:9.0f} "
               f"{roll:7.0f} {hf * 100:5.1f}%")
        if use_asr:
            lang = "th" if f.endswith("_th.mp3") else "en"
            segs, _ = asr.transcribe(f, language=lang)
            text = "".join(s.text for s in segs)
            row += f" {cer(SOURCE[lang], text) * 100:5.1f}%"
        print(row)

    print("\nF0 = pitch in Hz; HIGHER = shriller/แหลม (the main one for perceived pitch).")
    print("centroid/roll85/hf = timbre brightness.")
    if use_asr:
        print("CER = intelligibility; LOWER = clearer words.")


if __name__ == "__main__":
    main()
