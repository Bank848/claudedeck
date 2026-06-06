# ClaudeDeck — Session Handoff

Continue here in a fresh session. Repo: https://github.com/Bank848/claudedeck

## What ClaudeDeck is
Dark-mode Electron desktop app that "masks" the Claude Code CLI. Phase 1 = design-first UI
(chat, sessions tabs, kanban, diffs, skills, usage with Claude/Codex split) + a full
accessibility **voice assistant**.

## Stack
electron-vite + React + TS + Tailwind v3.4. `npm run dev` (or `start-dev.bat`) to run;
`npm run build` to verify. Typecheck: `npx tsc --noEmit -p tsconfig.json`.

## Voice — current state (works out of the box)
- **TTS engines:** `system` (offline SAPI, Thai via Pattara, pitch personas) and
  `edge` (free Edge-TTS neural, Thai/EN, no key, via main-process IPC). One-tap "มิกุ ✨"
  = Edge Ana + high pitch. Routing in `src/renderer/settings/tts.ts` (`speakSmart`).
- **STT / voice control:** browser SpeechRecognition + local Whisper (transformers.js).
  Hands-free commands with dual wake-word (assistant name "กุ้ง" OR selected voice name),
  pause/resume/close state machine. Bilingual (TH/EN). See `App.tsx` handleVoice +
  `settings/voiceCommands.ts`, `voiceLang`, `speechRecognition.ts`.

## Voice — real Miku ✅ WORKS (fairseq-free, verified 2026-06-07, commit df7e6fa)
- **Custom engine** (`ttsEngine: 'custom'`) → OpenAI-compatible `/v1/audio/speech`, via
  `settings/customTts.ts` + main IPC `tts:custom`. In-app Start/Stop in Settings → Custom (Miku).
- **`miku-server/` is now fairseq-free** so it runs on the user's **Python 3.13 + RTX 4070**
  (rvc-python pinned fairseq==0.12.2 which won't build on 3.12/3.13; no 3.10/3.11 installed).
  Vendored RVC v2 (MIT, RVC-Project) under `miku-server/rvc/`; HuBERT swapped fairseq →
  **ContentVec via HF transformers** (`lengyue233/content-vec-best`); F0 = pure-torch **rmvpe**.
  `rvc_infer.py` = engine, `server.py` = FastAPI (bg model load). `requirements` pin `transformers<5`.
- **Verified:** MikuAI v2 (sr 40000) → real Thai/EN speech. The full first-run install
  (torch cu124 ~2.5GB + ContentVec/rmvpe ~400MB) is already done in `miku-server/.venv` +
  HF cache, so Start is fast now.
- **Tuning — DONE & A/B-verified by ear (2026-06-07).** `server.py` is now
  **language-aware**: it detects Thai vs English (`_lang_of`, Thai-unicode regex) and
  applies a per-language `LANG` config. Final picked values:
  - **Thai:** voice `th-TH-PremwadeeNeural`, pitch **4**, protect **0.33**, filter_radius **5**
    (Thai is tonal → filter 5 steadies the tones, killing the "แปลก" warble).
  - **English:** voice `en-US-AnaNeural`, pitch **3**, protect **0.2**, filter_radius 3.
  - **Shared:** `RVC_BASE_RATE=-10%` (slower edge-tts base = more frames/phoneme = clearer
    consonants), index_rate 0.5. Every field is env-overridable (`RVC_PITCH_TH`, `RVC_PROTECT_EN`,
    `BASE_VOICE_TH`, …); see the `LANG` dict + `convert()` docstring.
  - **Why per-language pitch:** the EN base (Ana) sits ~6 semitones above the Thai base, so at a
    shared pitch English hit F0 ~390 Hz (shrill). Per-language pitch lands both in the same
    pleasant Miku-alto zone (Thai ~258 Hz / EN ~348 Hz). RVC stays language-agnostic — **no Thai
    dataset needed**; `protect` LOWER = clearer consonants (blends in the original on unvoiced frames).
- **Tuning harnesses (committed, reusable):** `_tune.py` (protect×rate A/B), `_tune_en.py` /
  `_tune_th.py` (pitch sweeps, take pitches as argv), and **`_analyze.py`** — objective metrics
  with NO model: F0 (the real "แหลม"/pitch number), spectral centroid (brightness), loudness, and
  optional `--asr` intelligibility (faster-whisper CER vs source text). Run from `miku-server/`
  with `.venv\Scripts\python.exe`. mp3 renders are gitignored (`miku-server/miku_*.mp3`).

## TODO (remaining) — next session starts here

**1. Voice latency (measure first).** User asked "how long until Miku starts reading?".
   Synthesis is non-streaming: `synth()` does edge-tts round-trip → full RVC convert → mp3,
   all before any audio plays, so TTFB ≈ whole-clip time. Next steps:
   - Add timing logs around the edge-tts call and `_engine.convert()` in `server.py` (or a
     `_bench.py` reusing the engine) and report cold (model-load, one-time) vs warm per-utterance
     latency for a short vs long sentence on the RTX 4070.
   - If warm latency is too high for chat: **sentence-chunk + stream** — split the response into
     sentences, synth each, and stream MP3 chunks so playback starts after the first sentence.
     The OpenAI `/v1/audio/speech` shape can return chunked audio.

**2. Conversational barge-in (the big UX ask).** It must behave like a voice chatbot: while Miku
   is reading a response, a new wake-word/command should **immediately stop playback and start
   listening/acting** — don't wait for the read-aloud to finish.
   - Today TTS playback and STT live in `App.tsx` (`handleVoice`, `voiceState` machine) +
     `settings/voiceCommands.ts` / `speechRecognition.ts`. STT already keeps running, but TTS
     isn't cancelled on a fresh command.
   - Plan: keep the recognizer hot during TTS; on a detected wake-word/command mid-playback, call
     the existing cancel path (`speechSynthesis.cancel()` / stop the custom `<audio>`), flush the
     queue, then dispatch the new command. Reuse the "เงียบ"/quiet cancel that already exists.
   - Watch: echo/self-trigger (Miku's own audio re-entering the mic) — gate the recognizer or use
     the mic level / a short ignore-window while speaking.

**3. P2 — real backend (`node-pty`).** Brainstorm scope first: spawn real `claude`/`codex` CLI →
   stream into the terminal panel → parse output to drive chat cards / todos / diffs from real
   data → voice command → CLI → read the response aloud (ties into #1/#2).

**4. Polish / package:** electron-builder distributable.

Done earlier: Miku fairseq-free (commit df7e6fa), Storage UI, update banner, report-a-bug,
**voice articulation tuning (this session — language-aware Thai pitch 4 / EN pitch 3).**

### Next-session kickoff prompt
> อ่าน HANDOFF.md + memory (claudedeck-project.md). เสียงมิกุจูนเสร็จแล้ว (ไทย pitch 4 / อังกฤษ
> pitch 3, language-aware). งานต่อ เรียงลำดับ: (1) วัด latency เสียง — ใส่ timing ใน server.py /
> เขียน `_bench.py` รายงาน cold vs warm ต่อประโยคสั้น/ยาวบน RTX 4070; ถ้าช้าให้ทำ sentence-chunk
> streaming. (2) **barge-in** — กำลังอ่านอยู่ พอได้ยิน wake-word/คำสั่งใหม่ให้หยุดเสียงทันทีแล้วฟัง/
> ทำคำสั่งต่อ (แก้ใน App.tsx handleVoice + voiceCommands.ts; ระวัง echo เสียงตัวเองเข้าไมค์).
> (3) P2 node-pty ต่อ CLI จริง — brainstorm scope ก่อน. กฎ: ทำทีละข้อ, build/typecheck เขียวก่อน
> commit เสมอ, งานหนัก/รอ download ทำ background แล้วทยอย, คุม cost.

## Notes
- Persistent project memory exists at the user's Claude memory (claudedeck-project.md) and is
  auto-loaded — it has full detail. This file is the quick repo-side summary.
- Commit style: conventional commits; push to `main` (origin = Bank848/claudedeck).
