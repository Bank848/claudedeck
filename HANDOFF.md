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

## Voice — real Miku (in progress, user is setting up)
- **Custom engine** (`ttsEngine: 'custom'`) → OpenAI-compatible `/v1/audio/speech`, via
  `settings/customTts.ts` + main IPC `tts:custom`.
- **`miku-server/`** = local Python server: edge-tts (base language incl Thai) → RVC
  (community Miku `.pth`) → mp3. Auto-discovers any `.pth`/`.index` under `miku-server/models/`.
- **In-app control:** Settings → Voice output engine → Custom (Miku): Start/Stop server,
  open models folder, download .pth from URL, live log. (`settings/mikuServer.ts`, main IPC `miku:*`.)
- User downloaded **MikuAI** (Hatsune Miku RVC v2) into `miku-server/models/MikuAI/`.
- IMPORTANT: RVC is language-agnostic — **no Thai training needed**; Miku speaks Thai via the
  edge-tts base. Needs Python 3.10–3.11 + ffmpeg + CUDA torch on the user's machine.

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
