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
- **Tuning:** server defaults (RVC_PITCH=6 / RVC_INDEX_RATE=0.5 / protect 0.33) = the user's
  preferred "most-Miku" sound (`miku_test.mp3`). RVC is language-agnostic — **no Thai dataset
  needed**; clarity comes from the edge-tts base, not the model.

## TODO (remaining)
1. **Verify real run** (user's machine, has NVIDIA GPU): start Miku server in-app, place model,
   press Test → confirm Miku speaks. Fix `server.py` RVC params / ffmpeg issues from logs.
2. **Storage UI:** wire `settings/storage.ts` (`clearCachedData`, `estimateUsage`) into a
   Settings "Storage" section with a "Clear cached models & data" button.
3. **Update system:** on launch check GitHub Releases (latest tag vs `package.json` version) →
   non-blocking "update available" banner. (ROADMAP)
4. **Bug feedback:** in-app "Report a bug" → `shell.openExternal` a prefilled GitHub Issue
   (app version + OS). (ROADMAP)
5. **P2 — real backend:** `node-pty` to spawn the real `claude`/`codex` CLI; stream into the
   terminal panel; parse output → drive chat cards / todos / diffs from real data; voice
   command → CLI → read response aloud.
6. Optional: package/distribute (electron-builder), polish.

## Notes
- Persistent project memory exists at the user's Claude memory (claudedeck-project.md) and is
  auto-loaded — it has full detail. This file is the quick repo-side summary.
- Commit style: conventional commits; push to `main` (origin = Bank848/claudedeck).
