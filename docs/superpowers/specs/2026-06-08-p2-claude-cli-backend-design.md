# P2 — Real `claude` CLI backend (Slice A) — Design

**Date:** 2026-06-08
**Status:** Approved design → ready for `/plan`
**Scope:** ClaudeDeck item 3 (P2), **Slice A only**

---

## 1. Goal

One sentence: **spawn the real `claude` CLI per turn, parse its `stream-json` events, and render the streaming reply (text + tool cards) into the existing chat + terminal UI instead of mock data.**

Slice A is deliberately narrow. It ships *real data into chat + terminal*. It does **not** map todos/diffs (Slice B) and does **not** wire the voice→CLI→read-aloud loop (Slice C). Those are designed-for but out of scope here.

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Transport | **Headless `stream-json`** — `claude -p --output-format stream-json --verbose`. JSON events map ~1:1 onto our contract; no ANSI scraping. Terminal panel = a readable event/stderr log, not the raw TUI. |
| 2 | Provider | **claude first.** Code an adapter seam so codex can slot in later. |
| 3 | Permissions | **User-selectable in the UI** via `--permission-mode` (`plan` / `acceptEdits` / `bypassPermissions` / `default`). **Default = `plan`** (safest). |
| 4 | Approval cards | Interactive Allow/Deny (`--permission-prompt-tool`) is **deferred** (post-Slice-A). |
| 5 | Turn model | **Per-turn spawn + `--resume <session_id>`.** Cancel = kill the process tree. |
| 6 | node-pty | **Not used in Slice A.** `stream-json` is read over stdout pipes via `child_process.spawn` (existing Miku pattern). node-pty is reserved for the future real-TUI terminal (#3 hybrid). |

CLI flags above were verified against the installed `claude --help` (2026-06-08): `--print`, `--output-format`, `--input-format`, `--resume`, `--permission-mode`, `--model`, `--verbose`, `--allowedTools/--disallowedTools`, `--include-partial-messages` all exist.

## 3. The real work (per scrutinize): static-import → React state

**This is the headline task, not a no-op.** Today the UI is wired to static fixture *imports*, so nothing can grow over time:

- `App.tsx:37` — `activeSession` = `SESSIONS.find(...)`, and `SESSIONS` is an imported const (`fixtures.ts:311`), **not** React state.
- `ChatView.tsx:25` renders `session.messages` (fine — it's pure props-in).
- `TerminalOutput.tsx:2,24` reads the static `TERMINAL_LINES` import directly, **no props**.
- `Composer.tsx:40` — send is a literal `// mock send — no-op`; no `onSend` prop; the selected `modelId` (`:21`) is Composer-local and never surfaced upward.

**Spine:** introduce a single **`useSessions` reducer** (or context), **seeded from the `SESSIONS` fixture** so existing tabs keep rendering. The active session's `messages` becomes mutable, and we add a per-session `terminalLines: TerminalLine[]` field. `streamMapper` dispatches into this reducer. Everything else hangs off this spine.

## 4. Architecture

### Main process (`electron/claude.ts` — new file, keep `main.ts` lean)
- `detectClaude(): Promise<boolean>` — locate the `claude` binary (PATH / common install dirs). Exposed via IPC `claude:available`.
- `startTurn({ turnId, prompt, sessionId?, cwd, model?, permissionMode })`:
  - `spawn('claude', argv, { cwd })` — **argv array, never `shell:true`** (prompt passed as an arg, not interpolated → no shell injection).
  - argv = `['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', mode, ...(model?['--model',model]:[]), ...(sessionId?['--resume',sessionId]:[])]`
  - stdout → split on newlines → `JSON.parse` each line → `webContents.send('claude:event', { turnId, event })`. A malformed line is forwarded as a stderr log line, **never throws**.
  - stderr → `claude:stderr` `{ turnId, text }`.
  - exit → `claude:done` `{ turnId, code }`.
- `cancelTurn(turnId)` — kill the process tree (reuse the `taskkill /T /F` pattern at `main.ts:64`).
- IPC handlers + `preload` → `window.claudedeck.claude.{ available, startTurn, cancelTurn, onEvent, onStderr, onDone }` (mirror the existing `miku` surface).

### Renderer (`src/renderer/cli/` — new folder)
- `types.ts` — TS types for the subset of `claude` stream-json events we consume (`system`/init, `assistant` message w/ `text`|`tool_use`|`thinking` content blocks, partial `stream_event` deltas, `user` w/ `tool_result`, `result`).
- `streamMapper.ts` — **pure, exported, unit-tested.** A reducer step: `(state, event) → state` that folds the event stream into `ChatMessage.parts[]`:
  - `system`/init → capture `session_id`, model, cwd, tools.
  - `assistant` `text` → append/extend a `markdown` part (handles both whole-message and partial deltas).
  - `assistant` `tool_use` → push a `tool` part with `ToolCall{ status:'running' }`.
  - `assistant` `thinking` → `thinking` part.
  - `user` `tool_result` → find the matching `ToolCall` by id, set `status:'done'|'error'` + `output`.
  - `result` → finalize (clear `streaming`, record tokens/cost).
  - Pure data in/out → fully testable against captured event-log fixtures with no Electron. **This is the coverage anchor (80%+).**
- `claudeClient.ts` — thin renderer wrapper over `window.claudedeck.claude`: `sendMessage`, `cancel`, `subscribe(turnId, handlers)`. Style mirrors `settings/mikuServer.ts` `useMikuServer()`.

### Wiring
- `useSessions` reducer owns sessions (seeded from fixture) + dispatches mapper output for the active live session.
- `Composer`: add `onSend(text, modelId)` to props; wire Enter (`Composer.tsx:40`) + send button (`:95`); lift `modelId` up through the callback.
- `ChatView`: pass `onSend` through to `Composer`.
- `TerminalOutput`: accept `lines: TerminalLine[]` via props (fall back to fixture when not live).
- A **Live ↔ Mock** toggle + **permission-mode dropdown** (default `plan`) near the session/status area. Mock stays the default until the user connects.

## 5. Data flow (Slice A)

```
Composer onSend(text, modelId)
  → claudeClient.sendMessage  → IPC claude:start { turnId, prompt, sessionId?, cwd, model, permissionMode }
  → main: spawn claude -p <prompt> --output-format stream-json --verbose --include-partial-messages
            --permission-mode <mode> [--resume <id>] [--model <id>]   (argv array, no shell, cwd = session.cwd)
  → stdout lines → JSON.parse → claude:event ;  stderr → claude:stderr ;  exit → claude:done
  → streamMapper folds events → useSessions dispatch → active ChatMessage grows (streaming) → ChatView renders
  → TerminalOutput shows the raw event + stderr log
  → on done: streaming=false; store session_id for the next turn's --resume
```

## 6. Safety

- `spawn` with **no `shell:true`**, prompt as an argv element (injection-safe). Fixed flag allow-list.
- Validate `cwd` exists before spawn; pass it to `spawn(..., { cwd })` so claude operates on the session's project (`--add-dir` if extra roots are ever needed).
- `--permission-mode` defaults to `plan` (read-only-ish); user opts up explicitly.
- No secrets logged; stderr is surfaced verbatim to the terminal panel only.
- Binary not found → `claude:available=false` → UI shows "claude CLI not detected" + install hint; stays on mock.

## 7. Error handling

- Malformed JSON line → push to terminal log as a stderr line; mapper continues.
- Non-zero exit / `result` error subtype → mark the streaming message `error`, surface in terminal.
- Kill on cancel is best-effort; `claude:done` always fires so the UI can settle state.

## 8. Testing

- **Unit:** `streamMapper.ts` against captured stream-json event arrays (AAA, no Electron) → assert resulting `ChatMessage.parts` for: plain text, partial deltas, a tool_use→tool_result round-trip, an error result. Coverage anchor.
- **Unit:** `useSessions` reducer transitions (seed, append message, grow streaming message, finalize).
- **Manual (real Electron):** connect → send → observe streaming text + a Read/Grep tool card resolving + terminal log; Stop button kills the turn.

## 9. Explicitly out of scope (designed-for, deferred)

- **Slice B:** map `TodoWrite` events → TodoPanel/Kanban; map file edits → DiffView.
- **Slice C:** voice → CLI → read-aloud loop; voice-driven turn cancel (its own phrase, e.g. "หยุดทำงาน", distinct from "เงียบ" which stays TTS-only). **No voice cancel-hook in Slice A.**
- Interactive Allow/Deny permission cards (`--permission-prompt-tool`).
- codex adapter (seam only, no implementation).
- Real node-pty terminal (#3 hybrid).

## 10. Open items to confirm at `/plan` time

- Exact partial-message event shape from `--include-partial-messages` (capture a real event log first).
- Where the Live/Mock toggle + permission dropdown live (StatusBar vs Sessions header).
