"""
ClaudeDeck — Miku voice latency benchmark.

Answers "how long until Miku starts reading?" Synthesis is non-streaming
(edge-tts round-trip → full RVC convert → mp3 all before any audio plays), so the
total time below IS the time-to-first-byte the chat UI experiences.

What it reports, per sentence (short/long × Thai/English):
  - edge   : base TTS round-trip (network → edge-tts) + decode to 16 kHz
  - rvc    : ContentVec + rmvpe + synthesizer on the GPU (the heavy part)
  - mp3    : final encode
  - total  : TTFB — what the user waits before audio starts
  - RTF    : total / audio-seconds. <1 = faster than realtime (good for streaming);
             a 3 s clip at RTF 0.4 renders in ~1.2 s.

COLD vs WARM:
  The first convert pays one-time costs (CUDA context, cuDNN autotune, lazy weight
  upload). We report that first call separately, then the median of WARM repeats —
  warm is what a user feels on the 2nd+ utterance of a session.

Run from miku-server/:
    .venv\\Scripts\\python.exe _bench.py            # default: 3 warm reps
    .venv\\Scripts\\python.exe _bench.py --reps 5
    .venv\\Scripts\\python.exe _bench.py --device cpu
"""

import os
import sys
import time
import asyncio
import tempfile
import statistics

import numpy as np
import edge_tts
from pydub import AudioSegment

# Reuse the exact server config so the benchmark measures the real pipeline.
import server  # noqa: E402  (sets up LANG, BASE_RATE, MODEL_PATH, etc.)

SENTENCES = {
    ("th", "short"): "สวัสดีค่ะ มิกุพร้อมแล้วนะคะ",
    ("th", "long"): (
        "สวัสดีค่ะ วันนี้อากาศดีมากเลยนะคะ ฉันชื่อมิกุ ยินดีที่ได้รู้จักค่ะ "
        "เดี๋ยวฉันจะอ่านผลรีวิวโค้ดให้ฟังนะคะ คุณจะได้ไม่ต้องจ้องหน้าจอตลอดเวลา"
    ),
    ("en", "short"): "Hi there, Miku is ready.",
    ("en", "long"): (
        "Hi there! I'm Miku. Let me read your code review out loud so you can keep "
        "your eyes off the screen and just listen while I walk through the changes."
    ),
}


def _arg(flag: str, default: str) -> str:
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


def _edge_to_16k(text: str, cfg: dict) -> tuple[np.ndarray, float]:
    """Run edge-tts → decode to 16 kHz mono. Returns (audio, seconds spent)."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "base.mp3")
        kwargs = ({"rate": server.BASE_RATE}
                  if server.BASE_RATE and server.BASE_RATE != "+0%" else {})
        t0 = time.perf_counter()
        asyncio.run(edge_tts.Communicate(text, cfg["voice"], **kwargs).save(path))
        seg = AudioSegment.from_file(path).set_channels(1).set_frame_rate(16000)
        x = np.array(seg.get_array_of_samples()).astype(np.float32)
        x /= float(1 << (8 * seg.sample_width - 1))
        return x, time.perf_counter() - t0


def main() -> None:
    reps = int(_arg("--reps", "3"))
    device = _arg("--device", os.environ.get("RVC_DEVICE") or "")

    from rvc_infer import MikuRVC

    if not os.path.exists(server.MODEL_PATH):
        print(f"No model at {server.MODEL_PATH}. Put a Miku .pth under models/.")
        return

    print(f"Loading engine (model={server.MODEL_PATH}, device={device or 'auto'})…")
    t_load = time.perf_counter()
    eng = MikuRVC(server.MODEL_PATH, server.INDEX_PATH,
                  device=device or None, is_half=server.USE_HALF)
    print(f"Engine loaded in {time.perf_counter() - t_load:.1f}s  "
          f"(device={eng.device}, sr={eng.tgt_sr})\n")

    def convert(audio16k: np.ndarray, cfg: dict) -> tuple[float, float]:
        """One RVC convert. Returns (seconds, audio-seconds-produced)."""
        t0 = time.perf_counter()
        out, sr = eng.convert(audio16k, f0_up_key=cfg["pitch"],
                              index_rate=server.INDEX_RATE, protect=cfg["protect"],
                              filter_radius=cfg["filter"])
        return time.perf_counter() - t0, (len(out) / sr if sr else 0.0)

    hdr = (f"{'sentence':14} {'edge':>6} {'rvc(cold)':>10} {'rvc(warm)':>10} "
           f"{'audio':>6} {'TTFB(warm)':>11} {'RTF':>5}")
    print(hdr)
    print("-" * len(hdr))

    first_convert_done = False
    for (lang, size), text in SENTENCES.items():
        cfg = server.LANG[lang]
        audio16k, edge_s = _edge_to_16k(text, cfg)

        # Cold convert: the very first convert across the whole run pays the
        # one-time CUDA/cuDNN warmup; later "cold" rows are already warm hardware.
        cold_s, audio_s = convert(audio16k, cfg)
        warm = []
        for _ in range(reps):
            w_s, audio_s = convert(audio16k, cfg)
            warm.append(w_s)
        warm_s = statistics.median(warm)

        ttfb = edge_s + warm_s          # what the user waits, 2nd+ utterance
        rtf = ttfb / audio_s if audio_s else 0.0
        tag = "(1st=cold)" if not first_convert_done else ""
        first_convert_done = True
        print(f"{lang+'/'+size:14} {edge_s:6.2f} {cold_s:10.2f} {warm_s:10.2f} "
              f"{audio_s:6.2f} {ttfb:11.2f} {rtf:5.2f}  {tag}")

    print("\nTTFB = edge + warm rvc = seconds before audio starts (non-streaming).")
    print("RTF<1 means we render faster than realtime -> sentence-chunk streaming")
    print("would let playback start after the first sentence while the rest renders.")
    print("The first convert row carries the one-time GPU warmup; warm is the real")
    print("per-utterance cost for an active chat session.")


if __name__ == "__main__":
    main()
