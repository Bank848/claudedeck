# ClaudeDeck

ClaudeDeck is a dark-mode Windows desktop app for working with the Claude Code CLI through a polished Electron interface. It keeps the terminal close, but wraps it in a chat-first workspace with sessions, tabs, task panels, diffs, usage views, settings, voice output, and accessibility controls.

The project started as a design-first Claude-style shell and now includes the first live backend slice for spawning the real `claude` CLI through Electron IPC.

## Highlights

- Claude-style chat workspace with session tabs, message blocks, thinking blocks, tool cards, code rendering, and a composer.
- Live or mock mode from the status bar. Live mode streams `claude -p --output-format stream-json --verbose` into the renderer.
- Session state management with reducers, persistence helpers, fork-to-worktree flow, and recent-folder support.
- Permission mode controls, directory scope editing, branch/worktree controls, and git-aware UI pieces.
- Tasks, kanban, diffs, skills, usage, guide/reference, settings, and terminal views.
- Voice assistant features: system TTS, Edge-TTS, custom OpenAI-compatible TTS, read-aloud buttons, wake-word commands, local speech recognition hooks, and barge-in cancellation.
- Optional local "Miku" voice server under `miku-server/` using Edge-TTS plus RVC voice conversion.
- Electron Builder packaging for Windows installers.

## Status

ClaudeDeck is under active development.

- UI shell: built.
- Live Claude CLI backend: Slice A built and covered by tests.
- Real todos/diffs from CLI events: planned.
- Packaged Windows release flow: available through Electron Builder, still being polished.
- Local Miku voice server: optional, advanced, and resource-heavy.

## Screens

The main app is organized like a compact IDE:

```text
Title bar
Activity bar | Sidebar | Tabs + main view | Right panel
             |         | Terminal panel  |
Status bar
```

Main views:

- Chat
- Tasks
- Changes
- Skills
- Usage
- Guide
- Settings

## Requirements

- Windows
- Node.js and npm
- Claude Code CLI installed and available as `claude` for live mode
- Optional: Python 3.10-3.13, ffmpeg, and an NVIDIA GPU for the local Miku voice server

## Quick Start

Double-click `ClaudeDeck.exe` on Windows. The launcher installs dependencies if needed and starts the app without leaving a console window open.

Power-user launchers:

```bat
launcher\start-dev.bat
launcher\start-prod.bat
```

Terminal workflow:

```bash
npm install
npm run dev
```

Build and preview:

```bash
npm run build
npm start
```

## Scripts

```bash
npm run dev          # Start Electron/Vite dev mode
npm run build        # Build main, preload, and renderer bundles
npm start            # Preview the built Electron app
npm run typecheck    # TypeScript check
npm test             # Run Vitest tests
npm run pack         # Build unpacked Electron app
npm run dist         # Build installer with electron-builder
```

## Tech Stack

- Electron 31
- electron-vite
- React 18
- TypeScript
- Tailwind CSS 3.4
- Vitest
- lucide-react
- react-markdown and remark-gfm
- highlight.js
- react-resizable-panels
- Electron Builder

## Project Structure

```text
electron/
  main.ts                  Electron main process
  preload.ts               Safe renderer bridge
  claude.ts                Claude CLI process integration
  ipc.ts                   IPC wiring
  auth.ts                  Auth helpers
  git.ts                   Git helpers
  sessionStore.ts          Session persistence
  settingsStore.ts         Settings persistence

src/renderer/
  App.tsx                  Main app shell and voice command wiring
  cli/                     Claude stream mapping, auth, git, and client APIs
  components/              Shared controls and UI components
  layout/                  Title bar, activity bar, sidebars, panels, status bar
  settings/                TTS, STT, voice commands, routing, defaults
  state/                   Session state, active turns, fork helpers
  theme/                   Tokens and global styles
  views/                   Chat, tasks, diffs, skills, usage, guide, settings

miku-server/
  server.py                OpenAI-compatible local TTS endpoint
  rvc_infer.py             RVC conversion glue
  rvc/                     Vendored RVC inference code

docs/
  superpowers/             Design specs and implementation plans
```

## Live Claude Mode

Live mode starts the real Claude CLI from the Electron main process and streams structured events back to the renderer. The current implementation uses:

```text
claude -p --output-format stream-json --verbose
```

The renderer folds stream events into chat messages and terminal lines. Permission mode controls are exposed in the UI, with `plan` as the conservative default.

If `claude` is not installed or cannot be found, switch back to mock mode from the status bar while developing the UI.

## Voice Features

ClaudeDeck includes several voice paths:

- System TTS through local Windows voices.
- Edge-TTS neural voices through main-process IPC.
- Custom TTS through an OpenAI-compatible `/v1/audio/speech` endpoint.
- Read-aloud controls for assistant messages.
- Voice commands for sending, reading, stopping, mode switching, and permission changes.
- Barge-in cancellation so a new command can stop current speech before handling the next action.

Advanced users can run the optional local Miku voice server:

```bat
cd miku-server
run.bat
```

Then select the custom voice engine in ClaudeDeck settings and point it at:

```text
http://127.0.0.1:5050
```

See `miku-server/README.md` for model setup, GPU notes, and tuning options.

## Testing

Run the automated checks before shipping changes:

```bash
npm run typecheck
npm test
npm run build
```

The test suite covers stream mapping, session reducers, auth, git helpers, permission handling, settings logic, voice command parsing, and focused renderer utilities.

## Roadmap

Near-term work:

- Drive todos and diffs from real Claude CLI events.
- Improve partial-message streaming and auto-read behavior.
- Add a Codex adapter behind the same IPC shape.
- Continue packaging polish for distributable Windows builds.
- Add release/update flow through GitHub Releases.

See `ROADMAP.md` and `HANDOFF.md` for deeper implementation notes.

## License

MIT
