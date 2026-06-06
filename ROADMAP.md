# ClaudeDeck — Roadmap

Backlog of planned work (not yet built). Phase 1 (design-first UI) is done.

## Voice / TTS
- **Decide engine for Thai + anime voice** (in progress):
  - System (Microsoft Pattara) — Thai, offline, works now (pitch personas).
  - Fish Audio **cloud** (S2) — Miku/anime + Thai, needs API key, free tier ~7 min/month.
  - **F5-TTS-THAI** (local, GPU ~8–12GB) — Thai + clone any voice (e.g. Miku from a clip).
  - **Edge-TTS** (free, no key, online) — neural Thai voices, unlimited-ish, not anime.
  - fish-speech self-host — rejected: needs 24GB GPU + Linux/WSL and has **no Thai**.

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
