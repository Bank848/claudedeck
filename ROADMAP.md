# ClaudeDeck Roadmap

ClaudeDeck is moving from a polished design shell into a real CLI-backed desktop workspace. This roadmap tracks the practical next steps rather than every experiment.

## Current State

Built:

- Electron, React, TypeScript, Tailwind app shell.
- Chat, sessions, tasks, changes, skills, usage, guide, settings, and terminal views.
- Live/mock mode toggle.
- First live Claude CLI backend slice through Electron IPC.
- Stream event folding into chat and terminal state.
- Permission mode controls and directory scope settings.
- Session reducer, session persistence helpers, fork-to-worktree flow, recent folders, and active turn tracking.
- System TTS, Edge-TTS, custom TTS, read-aloud controls, wake-word commands, and barge-in cancellation.
- Optional local Miku voice server with Edge-TTS plus RVC conversion.
- Unit tests for the core reducer, stream mapping, permissions, settings, auth, git, and voice utilities.

## Near Term

### 1. Live CLI Data

Goal: make the non-chat panels useful with real run data.

- Parse Claude CLI events into task/todo updates.
- Populate the changes/diff view from real file activity.
- Improve terminal event grouping and status messages.
- Keep the mock fixtures available for UI development and screenshots.

### 2. Streaming Polish

Goal: make live mode feel immediate and readable.

- Revisit partial-message streaming support.
- Improve assistant message growth while a turn is active.
- Add better cancellation feedback.
- Explore auto-read while streaming without speaking stale text.

### 3. Codex Adapter

Goal: support another CLI backend behind the same app shape.

- Define a shared process adapter interface.
- Add Codex command detection and launch path.
- Map Codex output into the existing chat/session event model.
- Keep Claude-specific behavior isolated from generic session state.

### 4. Packaging

Goal: make the app easy to install and update.

- Polish Electron Builder output.
- Verify installer behavior on clean Windows machines.
- Add app version display and release metadata.
- Add a GitHub Releases update check.
- Later: evaluate one-click auto-update.

## Voice Work

Shipping paths:

- System voices for offline use.
- Edge-TTS for free neural voices.
- Custom OpenAI-compatible TTS endpoint.
- Local speech recognition hooks and voice commands.

Optional advanced path:

- `miku-server/` for local Miku-style voice conversion.
- GPU strongly recommended.
- Community RVC v2 model required.

Future voice polish:

- Better echo protection for every read-aloud entry point.
- More robust command matching across Thai and English.
- Lower-latency custom TTS playback where practical.
- Clearer setup diagnostics for custom voice servers.

## Later Ideas

- In-app bug report flow that opens a prefilled GitHub issue.
- Better logs and diagnostics export.
- More keyboard-first workflow polish.
- Saved workspace profiles.
- Richer git timeline and branch comparison tools.
- Import/export settings.

## Quality Gates

Before a release candidate:

```bash
npm run typecheck
npm test
npm run build
npm run dist
```

Manual checks:

- Launch the packaged app on Windows.
- Toggle mock/live mode.
- Send a simple live Claude request.
- Cancel an active turn.
- Verify settings persistence after restart.
- Verify read-aloud and stop controls.
- Confirm installer/uninstaller behavior.
