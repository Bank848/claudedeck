# ClaudeDeck

A dark-mode desktop GUI that **masks the Claude Code CLI** — a polished shell where you watch Claude work, with a Claude-app-style chat plus session tabs, a live task/todo panel, a kanban board, a diff/changes view, a skills browser, and a terminal panel.

> **Phase 1 = design-first.** The whole UI is built and themed against realistic **mock data**. Buttons are styled but most are not wired yet. Phase 2 connects the real `claude` CLI via `node-pty`.

## Run it

Double-click **`start.bat`** (Windows). On first run it installs dependencies, builds, and launches the app. A coral splash shows while it boots.

For UI tuning with hot reload, double-click **`start-dev.bat`**.

Or from a terminal:

```bash
npm install
npm run dev      # hot-reload dev
npm run build    # production build
npm start        # launch built app
```

## Stack

Electron + electron-vite · React + TypeScript · Tailwind CSS v3.4 (CSS-variable tokens, dark only, Claude coral accent) · lucide-react · react-markdown + highlight.js · react-resizable-panels. Fonts: IBM Plex Sans + JetBrains Mono (bundled offline).

## Layout

```
TitleBar (frameless, window controls)
ActivityBar │ Sidebar │ Tabs + Center view │ Right panel (tasks/activity)
            │         │ Terminal panel     │
StatusBar (model · tokens · cwd · connection)
```

Center view switches via the ActivityBar: **Chat** (default) · **Tasks** (kanban) · **Changes** (diffs) · **Skills** · **Settings**.

## Accessibility (Settings)

- **Read text aloud (text-to-speech)** — toggle on to get a speaker button on every assistant message; uses the Web Speech API with a choice of system voice and adjustable speed (Esc stops). Built on `src/renderer/settings/speech.ts`.
- **Interface scale** (Small / Default / Large), **High contrast text**, and **Reduce motion** — all persisted to `localStorage` via `SettingsContext`.

## Project structure

```
electron/            main process, preload, inline splash
src/renderer/
  theme/             design tokens + global css
  mock/fixtures.ts   shared data contract (types + sample data)
  layout/            TitleBar, ActivityBar, Sidebar, TabStrip, RightPanel, BottomPanel, StatusBar
  views/
    chat/            Claude-style chat (messages, code, tool cards, thinking, streaming, composer)
    sessions/        sessions list
    skills/          searchable skills browser
    tasks/           TodoPanel (right) + KanbanBoard
    diffs/           DiffView
    terminal/        TerminalOutput
```

## Roadmap (next phases)

- **P2** — spawn the real `claude` CLI with `node-pty`; stream output into the terminal panel.
- **P3** — parse CLI output to drive chat cards, todos, and the changes view from real data.
- **P4** — real multi-session management, kanban persistence, skill invocation from the composer, settings.
