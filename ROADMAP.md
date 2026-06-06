# ClaudeDeck — Roadmap

Backlog of planned work (not yet built). Phase 1 (design-first UI) is done.

## Voice / TTS
Principle: **must work out of the box for any user** — no servers, GPUs, or API keys.

Shipping now (ready-to-use):
- **System** (e.g. Microsoft Pattara) — Thai, fully offline, instant. Pitch personas (incl. มิกุ-style bright).
- **Edge-TTS** (free, no key, unlimited, online) — neural Thai + English/JP voices. Pitch up for anime-ish tone.

"Miku ✨" one-tap = Edge Ana voice + high pitch (Miku-ish, free, instant, reliable).

Not shipped (need setup → not ready-to-use; revisit only if made one-click):
- **Custom local TTS server engine (opt-in)** — generic client to any local OpenAI-style TTS
  endpoint so power users can run a lightweight **RVC / VITS Miku** model. Runs on weak/onboard
  GPU or even CPU (slow). Ship with a clear "advanced / may be slow" warning + engine picker.
- fish-speech / Fish Audio cloud (Miku/anime) — removed: needs GPU server or API key.
- F5-TTS-THAI (local Thai + voice clone) — needs GPU.
- Real "Miku" timbre free+unlimited cloud — none ready-to-use (FakeYou free but slow/queued;
  HF "MIKU TTS" spaces only *sing*; ProsekaTTS speaks but Japanese).

## Update system (later)
- On launch, check **GitHub Releases** (latest tag) vs current `package.json` version.
- Show a non-blocking "Update available" banner linking to the release.
- Later: `electron-updater` for one-click auto-update.

## Feedback / bug report (later)
- In-app **"Report a bug"** button → opens a prefilled **GitHub Issue**
  (`shell.openExternal` to `…/issues/new?title=&body=`), auto-including app version + OS.
- Optional: attach last terminal/log snippet.

## Backend (P2+)
- `node-pty` to spawn the real `claude` / `codex` CLI; stream into the terminal panel.
- Parse CLI output → drive chat cards, todos, diffs from real data.
- Voice command → send to CLI → read the response aloud.
