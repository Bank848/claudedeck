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

**1. Voice latency — ✅ DONE (measured + streaming, 2026-06-07).**
   - **Instrumented** `server.py synth()` to log `edge/rvc/mp3/total(TTFB)/RTF` per request,
     and added **`_bench.py`** (loads engine once → cold vs warm convert, short/long × TH/EN).
   - **Measured (RTX 4070, MikuAI v2 sr 40000):** engine load 9.2s (one-time); first convert
     pays ~6.5s cuDNN warmup; **warm RVC 0.68–1.72s, RTF 0.29–0.74** (faster than realtime).
     Warm TTFB **2.3s short → 3.9s long**. Surprise: **edge-tts network is ~half** the TTFB.
   - **Streaming shipped** in `settings/customTts.ts`: `customSpeak()` splits the reply into
     sentence chunks (`splitIntoChunks`, exported/pure) and pipelines — synth chunk i+1 while
     chunk i plays → TTFB drops to first-sentence (~2s). First chunk ≤90 chars; Thai packs by
     word (no sentence punctuation) so it streams too. A **generation counter** (bumped by
     `stopCustom` + each new speak) preempts an in-flight reply at every await boundary — the
     **foundation for barge-in (item 2)**. No server protocol change (1 chunk = 1 request).

**2. Conversational barge-in — ✅ DONE (2026-06-07, commit d164ea7). Live-verify echo.**
   `App.tsx handleVoice` now calls `stopSpeaking()` (= `cancelSmart()` across system/edge/custom)
   right before dispatching a fresh wake-word/command, so a new command interrupts Miku mid-read
   instead of waiting it out. Builds on item 1b's generation-counter preemption → stops at
   sentence granularity, no stale chunks. Also fixed: "เงียบ"/quiet used `cancelSpeech` (system
   only) → now `cancelSmart` (stops Miku too).
   - **Echo guard:** (a) the wake-word gate (default on) — Miku's reply won't contain the
     assistant/voice name, so echo never passes; (b) `speakingRef`+`spokenTextRef` track the
     read-aloud text and drop any transcript that's a substring of what Miku is currently saying
     (covers the rare case where the reply itself contains the wake word).
   - **⚠ Live-verify (only doable in the real Electron app — mic + GPU):** say "อ่าน", then
     mid-read say "<wake-word> หยุด"/"<wake-word> แชท" → read must stop instantly + act, with no
     self-trigger from Miku's own audio. Note: chat-side `ReadAloudButton` reads still get stopped
     by barge-in (cancelSmart), but aren't covered by the substring echo guard (only the voice-
     initiated "อ่าน" path sets `spokenTextRef`) — acceptable; revisit if echo shows up there.

**3. P2 — real `claude` CLI backend — ✅ Slice A DONE (2026-06-08).**
   Decision: NOT node-pty — spawn `claude -p --output-format stream-json --verbose` over stdout
   pipes (the Miku `spawn`/`taskkill` pattern; no shell, argv array, validated cwd, default
   `--permission-mode plan`). Slice A shipped (plan: `docs/superpowers/plans/2026-06-08-p2-claude-cli-slice-a.md`):
   - **Spine:** `useSessions` reducer (pure, tested) replaces the static `SESSIONS` import; a pure
     `foldEvent` mapper folds stream-json `system`/`assistant`/`user`/`result` events into
     `ChatMessage.parts[]` (text → tool card → text). 17 vitest tests (mapper + reducer + voice).
   - **Main↔renderer:** `electron/claude.ts` (`detectClaude`/`startTurn`/`cancelTurn`) +
     `claude:*` IPC + preload `claude` surface + `claudeClient.ts` renderer wrapper.
   - **UI:** Composer `onSend` + imperative `submit()`; live per-session terminal lines; StatusBar
     **Live/Mock** toggle + **permission-mode** dropdown (keyboard + aria reachable).
   - **A11y (first-class):** voice **"ส่ง"** → `composerRef.submit()`; spoken status via `speakSmart`
     (user's chosen voice) — "กำลังคิด"/"กำลังใช้ <tool>"/"เสร็จแล้ว"/"เกิดข้อผิดพลาด"; aria-live
     region; **"อ่าน"** reads the live reply; voice live/mock + permission commands; `dispatchCommand`
     now **longest-match** so natural Thai sentences resolve (short keyword can't hijack a sentence).
   - **Deviation (recorded):** dropped `--include-partial-messages` (token-level deltas) — message-level
     events already read as streaming and fold deterministically. Deltas + auto-read-while-streaming → Slice C.
   - **⚠ Manual verify pending (needs real Electron app + installed `claude` CLI):**
     sighted smoke (toggle → Live → send "list two colors" → assistant grows, terminal logs, `--resume`
     keeps context on follow-up) AND blind UX eyes-closed (dictate → "ส่ง" → hear spoken cues in the
     selected voice → "อ่าน" reads reply → "โหมดสด"/"โหมดวางแผน" change controls). Automated gate
     (17 tests + typecheck + build) is green.
   - **Remaining:** Slice B (todos/diffs from real data) + Slice C (auto-read while streaming, voice
     cancel, partial-message deltas, codex adapter via the same IPC seam).

**4. Polish / package:** electron-builder distributable.

Done earlier: Miku fairseq-free (commit df7e6fa), Storage UI, update banner, report-a-bug,
voice articulation tuning (language-aware Thai pitch 4 / EN pitch 3),
voice latency: measured + sentence-chunk streaming (commits 900fe76, 566eb81),
**conversational barge-in (commit d164ea7), P2 Slice A — real claude CLI backend (2026-06-08).**
Next: manual-verify Slice A in the real app, then P2 Slice B (todos/diffs from real data).

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
