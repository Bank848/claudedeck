# ClaudeDeck

ClaudeDeck is a dark-mode Windows desktop app for working with the Claude Code CLI through a polished Electron interface. It keeps the terminal close, but wraps it in a chat-first workspace with sessions, tabs, a session library, tasks, diffs, usage views, settings, voice output, and accessibility controls.

The app started as a design-first Claude-style shell and now includes a live backend for spawning the real `claude` CLI through Electron IPC.

Think of it as a quiet cockpit for long coding sessions: Claude thinks, tools run, sessions stay organized, and the voice assistant keeps you moving without breaking flow.

ลองใช้ ClaudeDeck ถ้าคุณเขียนโค้ดกับ Claude บ่อย ๆ: มันเปลี่ยน terminal เปล่า ๆ ให้เป็น workspace มีแชต session diff task settings และเสียงช่วยอ่านครบในที่เดียว เหมาะกับงานยาวที่อยากให้ทุกอย่างเป็นระเบียบและตามต่อได้ง่าย.

## Highlights

- Claude-style chat workspace with message blocks, thinking blocks, tool cards, permission prompts, code rendering, and a composer.
- Live or mock mode from the status bar. Live mode streams `claude -p --output-format stream-json --verbose` into the renderer.
- Session library with open tabs, soft-close behavior, pinned sessions, archived sessions, persisted metadata, and transcript hydration from Claude JSONL files.
- Session state reducers, active turn tracking, fork-to-worktree flow, recent-folder support, and first-message title derivation.
- Permission mode controls, tool allow/deny rules, directory scope editing, branch/worktree controls, and git-aware UI pieces.
- Tasks, kanban, diffs, skills, usage, guide/reference, settings, terminal output, and update banners.
- Voice assistant features: system TTS, Edge-TTS, custom OpenAI-compatible TTS, read-aloud buttons, wake-word commands, local speech recognition hooks, and barge-in cancellation.
- Optional local "Miku" voice server under `miku-server/` using Edge-TTS plus RVC voice conversion.
- Electron Builder packaging for Windows installers, GitHub Releases checks, and packaged-app update support.
- Main-process safety hardening around IPC, external links, CSP, URL validation, downloads, and settings/session persistence.

## Status

ClaudeDeck is under active development.

- UI shell: built.
- Live Claude CLI backend: built and covered by tests.
- Session library and tab lifecycle: in progress, with soft-close, pin, archive, and restore primitives in place.
- Real todos/diffs from CLI events: planned.
- Packaged Windows release flow: available through Electron Builder, still being polished.
- Local Miku voice server: optional, advanced, and resource-heavy.

## Screens

The main app is organized like a compact IDE:

```text
Title bar
Activity bar | Sidebar/session library | Tabs + main view | Right panel
             |                         | Terminal panel  |
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
- Optional: Python, ffmpeg, and an NVIDIA GPU for the local Miku voice server

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
npm test             # Run Vitest tests once
npm run test:watch   # Run Vitest in watch mode
npm run pack         # Build unpacked Electron app
npm run dist         # Build installer and zip with electron-builder
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
- electron-updater
- Electron Builder

## Project Structure

```text
electron/
  main.ts                  Electron main process and IPC registration
  preload.ts               Safe renderer bridge
  claude.ts                Claude CLI process integration
  ipc.ts                   Safe IPC wrappers
  auth.ts                  Claude login/logout helpers
  git.ts                   Git helpers
  sessionStore.ts          Session index + Claude transcript lookup
  settingsStore.ts         Disk-backed app settings
  permissions.ts           Persistent permission settings helpers
  permissionProtocol.ts    Mid-turn permission request protocol
  netGuard.ts              URL and download safety checks
  modelClassifier.ts       Optional model-tier classifier
  mikuPreflight.ts         Local voice server setup checks
  mikuSetup.ts             Embedded Python / torch setup helpers

src/renderer/
  App.tsx                  Main app shell, session wiring, and voice command wiring
  cli/                     Claude stream mapping, auth, git, permissions, and client APIs
  components/              Shared controls and UI components
  layout/                  Title bar, activity bar, sidebars, panels, status bar
  settings/                TTS, STT, updater, voice commands, routing, defaults
  state/                   Session state, grouping, titles, active turns, fork helpers
  theme/                   Tokens and global styles
  views/                   Chat, tasks, diffs, skills, usage, guide, settings, sessions

miku-server/
  server.py                OpenAI-compatible local TTS endpoint
  rvc_infer.py             RVC conversion glue
  rvc/                     Vendored RVC inference code

docs/
  superpowers/             Design specs and implementation plans
  distribution-release-plan.md
  model-routing-plan.md
  SIGNING.md
```

## Live Claude Mode

Live mode starts the real Claude CLI from the Electron main process and streams structured events back to the renderer. The current implementation uses:

```text
claude -p --output-format stream-json --verbose
```

The renderer folds stream events into chat messages and terminal lines. Claude session IDs are persisted so later turns can resume context, and the app can hydrate previous transcripts from `~/.claude/projects/**/<session-id>.jsonl` when available.

Permission controls are exposed in the UI, including modes, per-turn allow/deny tool rules, additional directories, and mid-turn permission responses. If `claude` is not installed or cannot be found, switch back to mock mode from the status bar while developing the UI.

## Session Library

ClaudeDeck separates open tabs from stored sessions:

- A tab is a session currently marked `open`.
- Closing a tab soft-closes it; the session stays in the sidebar library.
- Sessions can be reopened, pinned, archived, restored, renamed, and permanently deleted from the archive flow.
- Session metadata is stored in the app's `sessions.json`; Claude-owned JSONL transcripts are only read, not deleted.

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

The packaged app also includes UI hooks for Miku preflight checks, setup progress, model download, server start/stop, health polling, and prewarm requests. See `miku-server/README.md` for model setup, GPU notes, and tuning options.

## Packaging And Updates

Windows packaging uses Electron Builder:

```bash
npm run pack
npm run dist
```

Release artifacts are written under `release/<version>/`. The build config targets NSIS and zip outputs and is wired to the `Bank848/claudedeck` GitHub Releases feed.

Packaged NSIS installs can use `electron-updater` for update checks, downloads, and install-on-restart. Dev and portable zip builds fall back to a lightweight GitHub Releases latest-version check.

## Testing

Run the automated checks before shipping changes:

```bash
npm run typecheck
npm test
npm run build
```

The test suite covers stream mapping, session reducers, session grouping, session titles, auth, git helpers, permission handling, settings logic, updater utilities, voice command parsing, and focused renderer utilities.

## Roadmap

Near-term work:

- Finish the session library UI polish and manual verification.
- Drive todos and diffs from real Claude CLI events.
- Improve partial-message streaming, cancellation feedback, and auto-read behavior.
- Add a Codex adapter behind the same IPC shape.
- Continue packaging polish for distributable Windows builds.
- Harden release/update flow through GitHub Releases.

See `ROADMAP.md` and `HANDOFF.md` for deeper implementation notes.

## License

MIT
