# Spawn-task chip — design

**Date:** 2026-06-14
**Status:** Approved (brainstorm), pending implementation plan
**Goal:** Let the assistant running inside ClaudeDeck's inner `claude` CLI suggest
spinning off out-of-scope follow-up work into a new session. The suggestion renders
as a non-blocking **chip** in the chat; the user clicks **Spawn** to open a new tab
in the same folder seeded with the suggested prompt, or **Dismiss** to discard it.

This mirrors the real Claude app's `spawn_task` background-task chip.

---

## Problem

ClaudeDeck spawns a plain `claude` CLI subprocess
([`electron/claude.ts:212`](../../../electron/claude.ts) `buildArgs`) with only
standard flags + `--permission-prompt-tool stdio`. The inner CLI has **no
`spawn_task` tool** and **no knowledge of ClaudeDeck**, so the assistant has no way
to signal "this work should branch into another session." The existing
`spawnTask()` in [`src/renderer/App.tsx`](../../../src/renderer/App.tsx) only fires
from manual triggers (voice `"spawn"`, Ctrl+Shift+B, Composer button, Sidebar
button) and immediately opens a new empty tab — there is no assistant-driven,
click-to-confirm chip.

## Chosen approach (Option A — full MCP tool, matches Claude app)

Inject a ClaudeDeck-owned MCP tool `spawn_task` into the inner CLI, teach the
assistant about it via an appended system prompt, allowlist it so it runs without a
permission prompt in **every** permission mode (non-blocking), and render the
resulting `tool_use` block as an interactive chip in the transcript.

Rejected alternatives:
- **B (text marker convention):** lighter, but a prompt-only convention the model
  can forget or malform; not faithful to the Claude app.
- **C (pure heuristic on assistant text):** no CLI changes, but high false
  positive/negative rate, uncontrollable. Not pursued.

Decisions locked during brainstorm:
- **Always on, no setting toggle** — matches the Claude app (the `ccd_session`
  spawn tool is always injected; users cannot disable assistant-suggested spawns).
- **Non-blocking** — the tool returns success immediately; the model keeps working.
  The chip persists in the transcript until acted on.
- **Post-click behavior:** new tab, **same folder** as the current session, prompt
  delivered as the first turn (reuses existing `spawnTask(seed, cwd)`).
- **Not persisted across app restart** — chip action state is in-memory only,
  matching the Claude app (`spawn_task` ids are not persisted across restarts).

---

## Components

### 1. MCP server — `spawn_task` signal carrier
A minimal stdio MCP server owned by ClaudeDeck (e.g. `electron/mcp/spawnTaskServer`),
exposing one tool:

```
spawn_task(title: string, prompt: string, tldr: string, cwd?: string)
```

When invoked it does **not** spawn anything — it returns a synthetic success result
(e.g. a short confirmation text + a `task_id`) so the model treats the suggestion as
recorded and continues. The actual spawning happens in the renderer when the user
clicks the chip. Generating an id/timestamp here is fine — this is an ordinary Node
process, not a Workflow script.

### 2. `buildArgs` injection — `electron/claude.ts`
Every turn appends three things:
- `--mcp-config <ref>` pointing at the spawn-task MCP server. Resolve the server
  path for both dev and packaged builds; prefer writing a config file once at app
  startup (under userData) and passing its path, to avoid Windows quoting concerns.
- `--append-system-prompt <guidance>` — condensed `spawn_task` usage instructions
  (when to call, what fields to fill, what NOT to call it for). See "System prompt"
  below.
- merge `mcp__claudedeck__spawn_task` into the existing `--allowedTools` list so the
  CLI never asks permission for it — works in `default`, `acceptEdits`,
  `bypassPermissions`, etc. This is what makes the call non-blocking and removes any
  permission-prompt touch point.

The exact MCP server name (`claudedeck`) fixes the tool's wire name as
`mcp__claudedeck__spawn_task`; the allowlist token and the renderer detector must
use this exact string.

### 3. Block detector — stream/block mapping
In the block-mapping layer ([`src/renderer/cli/blockMapping.ts`](../../../src/renderer/cli/blockMapping.ts)
/ [`streamMapper.ts`](../../../src/renderer/cli/streamMapper.ts)), a `tool_use`
block whose `name === 'mcp__claudedeck__spawn_task'` is mapped to a **spawn-chip**
element rather than a normal `ToolCallCard`. The chip's identity is the `tool_use`
id (stable across live stream and transcript re-parse). The chip payload
(title/prompt/tldr/cwd) comes from the block's `input`.

Guard: if `input.prompt` is missing/empty, fall back to rendering nothing (or a
normal tool card) — never a blank chip.

### 4. `SpawnChip.tsx` — the chip UI
Renders `title` + `tldr` with two actions:
- **Spawn** → calls existing `spawnTask(prompt, cwd ?? currentSessionCwd)` → new
  tab, same folder, prompt as first turn. Then marks status `spawned` (chip shows
  "Opened →", action disabled).
- **Dismiss** → marks status `dismissed` (chip fades/hides).

Action state (pending | spawned | dismissed) lives in a per-session in-memory map
keyed by `toolUseId`, so it survives transcript re-renders within the session but
resets on app restart. Only `pending` chips have active buttons (guards
double-spawn). Accessibility: both actions are real focusable buttons with clear
`aria-label`s (the app is accessibility-first).

---

## Data flow

```
assistant calls spawn_task(title, prompt, tldr[, cwd])
  → inner CLI runs the allowlisted MCP tool → MCP returns success → model continues (non-blocking)
  → ClaudeDeck sees the tool_use block (name = mcp__claudedeck__spawn_task) in the stream
  → block mapping emits a SpawnChip (payload from block.input, id = tool_use id)
  → SpawnChip renders inline in the transcript, status = pending
      user clicks Spawn   → spawnTask(prompt, cwd = same folder) → new tab + first turn; status = spawned
      user clicks Dismiss → status = dismissed (chip hidden)
```

## System prompt (appended)

Condensed guidance, e.g.:

> You have a `spawn_task` tool. When you notice out-of-scope follow-up work worth
> doing separately — dead code, stale docs, a bug in unrelated code, missing test
> coverage — that would bloat the current change, call `spawn_task` with a
> self-contained `prompt` (the new session has no memory of this conversation —
> include file paths and enough detail to act cold), a short imperative `title`, and
> a one-line `tldr`. The user sees a chip and decides whether to spin it into a new
> session. Do NOT call it for vague observations, trivial inline fixes, or anything
> that needs this conversation's context to understand.

## Error handling

- **MCP server fails to start** → the assistant's `spawn_task` call errors at the
  CLI, but the chip still renders from the `tool_use` block (it carries the prompt),
  so it remains usable. Other turns are unaffected (non-fatal; mcp-config injection
  failure must never break a normal turn).
- **Missing `prompt` in input** → no chip rendered.
- **Double Spawn** → guarded by `pending`-only active buttons.
- **`respondPermission`/turn-gone races** → not applicable; the tool is allowlisted,
  so there is no permission round-trip.

## Testing

- `electron/claude.test.ts` — `buildArgs` includes `--mcp-config`,
  `--append-system-prompt`, and `mcp__claudedeck__spawn_task` in `--allowedTools`.
- block mapping — a `tool_use` named `mcp__claudedeck__spawn_task` maps to a spawn
  chip (not a `ToolCallCard`); a missing `prompt` produces no chip.
- `SpawnChip` component — Spawn calls `onSpawn` with `prompt` + resolved `cwd`;
  Dismiss transitions status; non-`pending` disables buttons.
- MCP server — calling `spawn_task` returns a success payload.

## Out of scope (future)

- Worktree/branch-isolated spawns (the `cwd` param leaves room; not built now).
- Persisting chip state across app restarts.
- A settings toggle to disable assistant-suggested spawns.
