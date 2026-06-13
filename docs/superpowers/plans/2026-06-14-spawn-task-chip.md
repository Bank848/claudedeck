# Implementation plan — spawn_task chip

**Date:** 2026-06-14
**Spec:** [`docs/superpowers/specs/2026-06-14-spawn-task-chip-design.md`](../specs/2026-06-14-spawn-task-chip-design.md) (Approved, commit 39e38b6)
**Branch:** main · **Stack:** Electron 31 + React 18 + TypeScript 5.7, electron-vite, Vitest

---

## Section A — Read this (humans)

### Goal
Let the assistant running inside ClaudeDeck's inner `claude` CLI **suggest** spinning
off out-of-scope follow-up work into a new session. The suggestion renders as a
non-blocking **chip** in the transcript; the user clicks **Spawn** (→ new tab, same
folder, prompt as first turn) or **Dismiss**. Mirrors the real Claude app's
`spawn_task` background-task chip.

### Key decisions (locked by spec)
- **Option A — real MCP tool.** Inject a ClaudeDeck-owned stdio MCP server exposing one
  tool `spawn_task`; teach the model via `--append-system-prompt`; allowlist
  `mcp__claudedeck__spawn_task` so it never prompts (non-blocking in every permission mode).
- **Signal carrier, not executor.** The MCP tool returns synthetic success; the real
  trigger is the `tool_use` block we detect in the stream. Spawning happens in the
  renderer only when the user clicks the chip (reuses `spawnTask()` at `App.tsx:863`).
- **Always on**, no setting toggle. **Not persisted** across app restart (in-memory status).
- **Graceful degradation.** If the MCP server/config fails, the call errors at the CLI but
  the chip **still renders** from the `tool_use` block. mcp-config injection must NEVER
  break a normal turn.

### Before / After

**Current — inner CLI has no spawn_task, no ClaudeDeck awareness**
```
buildArgs → [-p, stream-json, --permission-mode, --model, --allowedTools(user only), ...]
assistant text  ──► blockToPart ──► markdown / tool card / thinking
(no way for the assistant to suggest a new session)
```

**Proposed — injected MCP tool + chip**
```
startup: writeSpawnTaskMcpConfig(userData) → copies out/main/spawnTaskServer.js → userData/mcp/,
         writes userData/mcp/claudedeck-mcp.json (command=execPath, ELECTRON_RUN_AS_NODE=1)
         → setSpawnTaskMcpConfig(path)

buildArgs → [...existing, --mcp-config <path>, --append-system-prompt <guidance>,
             --allowedTools (user tools + mcp__claudedeck__spawn_task)]

inner claude launches the stdio MCP server (spawnTaskServer.js) → tool `spawn_task` exists
assistant calls spawn_task(title, prompt, tldr[, cwd]) → MCP returns success (non-blocking)
   ──► stream tool_use block (name = mcp__claudedeck__spawn_task)
   ──► blockToPart: name match + non-empty prompt ──► { kind:'spawn-chip', chip }   (else null/tool card)
   ──► AssistantMessage renders <SpawnChip> inline (status pending)
          Spawn   → onSpawn(prompt, cwd ?? sessionCwd) → spawnTask() → new tab + first turn; status=spawned
          Dismiss → status=dismissed (hidden)
```

### What's changing
**Added**
- `electron/mcp/spawnTaskServer.ts` — minimal stdio MCP server (pure dispatch + run loop).
- `electron/mcp/spawnTaskServer.test.ts`
- `electron/mcp/spawnTaskConfig.ts` — write mcp-config + copy server to userData (non-fatal).
- `electron/mcp/spawnTaskConfig.test.ts`
- `src/renderer/views/chat/spawnChipLogic.ts` — pure chip logic (cwd resolve, status map).
- `src/renderer/views/chat/spawnChipLogic.test.ts`
- `src/renderer/views/chat/SpawnChip.tsx` — thin view + context.

**Modified**
- `electron/claude.ts` — `buildArgs` injects the 3 flags; `SPAWN_TASK_TOOL`,
  `SPAWN_TASK_SYSTEM_PROMPT`, `setSpawnTaskMcpConfig()`.
- `electron/claude.test.ts` — assert injection; update the existing `--allowedTools` test.
- `electron/main.ts` — call `writeSpawnTaskMcpConfig` + `setSpawnTaskMcpConfig` at startup.
- `electron.vite.config.ts` — add `spawnTaskServer` main input.
- `src/renderer/mock/fixtures.ts` — new `MessagePart` kind `spawn-chip` + `SpawnChipData`.
- `src/renderer/cli/blockMapping.ts` — detect the tool → spawn-chip part (or null).
- `src/renderer/cli/blockMapping.test.ts` (new or existing) — detection tests.
- `src/renderer/views/chat/AssistantMessage.tsx` — render `spawn-chip` parts; speakable text.
- `src/renderer/views/chat/ChatView.tsx` — provide `SpawnContext`; new `onSpawnTask` prop.
- `src/renderer/App.tsx` — pass `spawnTask` into `ChatView`.

### Parallelization analysis
Two disjoint subsystems → two parallel tracks after the shared type change.

- **Task 1 (fixtures type)** is the only shared-file prerequisite for the renderer track. Do it first.
- **Batch 1 (parallel):**
  - *Electron track* — Task 2 (MCP server) ∥ Task 3 (config writer) touch different new files;
    Task 4 (claude.ts buildArgs) is independent of both.
  - *Renderer track* — Task 5 (blockMapping) depends on Task 1 only.
- **Batch 2 (parallel):** Task 6 (spawnChipLogic) ∥ — independent. Task 7 (SpawnChip.tsx) needs Task 6.
- **Batch 3 (sequential-ish):** Task 8 (AssistantMessage) needs Tasks 1,7. Task 9 (ChatView+App) needs Task 7.
- **Batch 4:** Task 10 (main.ts + vite config wiring) needs Tasks 2,3,4.
- **Critical path:** 1 → 6 → 7 → 8/9. Longest chain ≈ 4 steps.

> **Inline execution recommended** (10 small TDD tasks, one engineer, tightly coupled types).
> Parallel-subagent execution is viable along the two tracks if desired, but the file overlap
> on `fixtures.ts` / `AssistantMessage.tsx` keeps the win modest.

---

## Section B — Implementation plan

### Task 0 — Spike: validate `claude` CLI MCP assumptions (DO FIRST, fail fast)

This is ClaudeDeck's first MCP integration — three `claude`-CLI behaviors the design
depends on are unverified in this repo. `--append-system-prompt` is injected on **every**
turn, so a wrong flag name would brick all turns. Validate before building the chain.

- [ ] Hand-write a temp config `claudedeck-mcp.json` pointing `claudedeck` at a throwaway
  copy of the Task-2 server (or a 20-line node script implementing `dispatch`), launched via
  `process.execPath` + `ELECTRON_RUN_AS_NODE=1` (or plain `node`).
- [ ] Run, from a real shell, each of:
  - `claude --mcp-config <path> --append-system-prompt "test" -p "say hi"` → confirms the
    **flag names exist**, `--mcp-config` accepts a **file path** (not only inline JSON), and the
    `{mcpServers:{claudedeck:{command,args,env}}}` shape is accepted (server appears in `/mcp`).
  - The same with the server process **exiting immediately / returning malformed `initialize`**
    → confirms a broken MCP server is **non-fatal** (the turn still completes). This is the
    spec's hard requirement (spec:137-140).
  - The same with `--permission-mode plan` and the tool **allowlisted** → confirms an
    allowlisted MCP tool is callable (or at worst ignored) and does **not** error the turn.
- [ ] Confirm MCP stdio framing is **newline-delimited JSON-RPC** (not LSP Content-Length) and
  that `protocolVersion '2024-11-05'` is accepted on `initialize`.
- [ ] **If any assumption is wrong**, adjust before proceeding: wrong flag → fix/guard; inline-JSON
  only → make `setSpawnTaskMcpConfig` emit inline JSON (re-check `%`/quoting); broken-server
  **fatal** → gate `--mcp-config` (and `--append-system-prompt`) behind a startup health-check of
  the server instead of unconditional injection.

This spike is throwaway (no committed code); it de-risks Tasks 4 & 10.

### Architecture notes
- **Tool wire name is fixed by the MCP server name.** Server registered as `claudedeck` →
  tool `spawn_task` → wire name `mcp__claudedeck__spawn_task`. The allowlist token (electron)
  and the renderer detector MUST use this exact string. Defined as a const in each root
  (`SPAWN_TASK_TOOL` in `claude.ts`, `SPAWN_TASK_TOOL_NAME` in `blockMapping.ts`) — electron and
  renderer are separate build roots, so a shared import is avoided; tests pin the literal in both.
- **buildArgs purity.** `buildArgs` stays pure/sync (unit-tested without electron `app`). The
  mcp-config **path** is supplied via a module setter `setSpawnTaskMcpConfig()` that `main.ts`
  calls at startup. `--append-system-prompt` + the allowlist token are injected
  **unconditionally** (harmless without a server); `--mcp-config` is injected **only when a
  path is set and contains no `%`** (Windows `quoteForCmd` rejects `%`, per `cleanRules`).
- **Server launch (dev + packaged).** electron-vite builds `electron/mcp/spawnTaskServer.ts`
  → `out/main/spawnTaskServer.js` (CJS, node-builtins externalized). At startup `main.ts` reads
  `join(__dirname,'spawnTaskServer.js')` (real disk in dev; asar-readable by the main process
  when packaged) and copies it to `<userData>/mcp/spawnTaskServer.js` (real disk). The config
  launches it via `process.execPath` with `ELECTRON_RUN_AS_NODE=1` so no system `node` is needed
  and no script is executed from inside asar.
- **No RTL/jsdom** in the repo. Component "tests" follow the existing pattern
  (`modelSuggestionControls.ts`+`.tsx`, `ElapsedTimer`): logic in a pure `.ts` module with full
  tests; the `.tsx` is a thin view, optionally asserted via its `$$typeof` memo tag.

### File structure
```
electron/
  mcp/
    spawnTaskServer.ts        (new)  minimal stdio MCP server
    spawnTaskServer.test.ts   (new)
    spawnTaskConfig.ts        (new)  write config + copy server to userData
    spawnTaskConfig.test.ts   (new)
  claude.ts                   (mod)  inject flags + SPAWN_TASK_* + setSpawnTaskMcpConfig
  claude.test.ts              (mod)
  main.ts                     (mod)  wire startup config
electron.vite.config.ts       (mod)  add server build input
src/renderer/
  mock/fixtures.ts            (mod)  spawn-chip MessagePart + SpawnChipData
  cli/blockMapping.ts         (mod)  detect tool → chip part
  cli/blockMapping.test.ts    (new)
  views/chat/
    spawnChipLogic.ts         (new)  pure logic
    spawnChipLogic.test.ts    (new)
    SpawnChip.tsx             (new)  view + SpawnContext
    AssistantMessage.tsx      (mod)  render spawn-chip
    ChatView.tsx              (mod)  provide SpawnContext, onSpawnTask prop
src/renderer/App.tsx          (mod)  pass spawnTask to ChatView
```

---

### Task 1 — `MessagePart` gains a `spawn-chip` kind (shared type, do first)

**File:** `src/renderer/mock/fixtures.ts`

- [ ] Add the data interface and union member near the existing `MessagePart` (≈ line 72).

```ts
/** Payload for an assistant-suggested spawn_task chip (mirror of the MCP tool input). */
export interface SpawnChipData {
  /** The originating tool_use id — stable across live stream and transcript re-parse. */
  toolUseId: string
  title: string
  prompt: string
  tldr: string
  /** Optional working dir for the spawned session; falls back to the current session's cwd. */
  cwd?: string
}

export type MessagePart =
  | { kind: 'markdown'; text: string }
  | { kind: 'code'; content: CodeBlockContent }
  | { kind: 'tool'; call: ToolCall }
  | { kind: 'thinking'; text: string }
  | { kind: 'spawn-chip'; chip: SpawnChipData }
```

- [ ] `npm run typecheck` — expect errors in `AssistantMessage.tsx` switch exhaustiveness
  only if a `never` check exists (there is none; the part map returns `null` for unknown).
  Confirms the type compiles. No test for a pure type addition.

---

### Task 2 — MCP server (pure dispatch + run loop)

**File:** `electron/mcp/spawnTaskServer.ts` (new)

Write the test first.

**File:** `electron/mcp/spawnTaskServer.test.ts` (new)
```ts
import { describe, it, expect } from 'vitest'
import {
  SPAWN_TASK_TOOL_DEF,
  buildSpawnTaskCallResult,
  dispatch,
} from './spawnTaskServer'

describe('spawnTaskServer — tool definition', () => {
  it('exposes a spawn_task tool requiring title/prompt/tldr', () => {
    expect(SPAWN_TASK_TOOL_DEF.name).toBe('spawn_task')
    expect(SPAWN_TASK_TOOL_DEF.inputSchema.required).toEqual(['title', 'prompt', 'tldr'])
  })
})

describe('buildSpawnTaskCallResult — success payload (signal carrier)', () => {
  it('returns a non-error content payload with a stable task id', () => {
    const r = buildSpawnTaskCallResult({ title: 'Fix docs', prompt: 'p', tldr: 't' }, 0)
    expect(r.isError).toBeUndefined()
    expect(r.content[0].type).toBe('text')
    expect(r.content[0].text).toContain('Fix docs')
    expect(r.content[0].text).toMatch(/task_/)
  })

  it('tolerates a missing title', () => {
    const r = buildSpawnTaskCallResult({} as never, 0)
    expect(r.content[0].text).toBeTruthy()
  })
})

describe('dispatch — minimal MCP JSON-RPC', () => {
  it('answers initialize with tools capability + serverInfo', () => {
    const res = dispatch({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} })
    expect(res).toMatchObject({ id: 0, result: { serverInfo: { name: 'claudedeck' } } })
    expect((res as { result: { capabilities: { tools: unknown } } }).result.capabilities.tools).toBeDefined()
  })

  it('lists the spawn_task tool', () => {
    const res = dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as
      { result: { tools: Array<{ name: string }> } }
    expect(res.result.tools.map((t) => t.name)).toContain('spawn_task')
  })

  it('returns success for a tools/call of spawn_task', () => {
    const res = dispatch({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'spawn_task', arguments: { title: 'X', prompt: 'p', tldr: 't' } },
    }) as { result: { content: Array<{ text: string }> } }
    expect(res.result.content[0].text).toContain('X')
  })

  it('ignores notifications (no id) by returning null', () => {
    expect(dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('returns method-not-found for an unknown request', () => {
    const res = dispatch({ jsonrpc: '2.0', id: 9, method: 'resources/list' }) as
      { error: { code: number } }
    expect(res.error.code).toBe(-32601)
  })
})
```

**File:** `electron/mcp/spawnTaskServer.ts` (new)
```ts
/**
 * Minimal stdio MCP server owned by ClaudeDeck. Registered to the inner `claude`
 * CLI as the `claudedeck` server, so its one tool gets the wire name
 * `mcp__claudedeck__spawn_task`. It is a SIGNAL CARRIER, not an executor: the
 * tool returns synthetic success so the model keeps working (non-blocking); the
 * real spawn happens in the renderer when the user clicks the chip built from the
 * tool_use block. Newline-delimited JSON-RPC 2.0 over stdin/stdout, dependency-free
 * (node builtins only) so it runs under `process.execPath` with ELECTRON_RUN_AS_NODE.
 */
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2024-11-05'

export const SPAWN_TASK_TOOL_DEF = {
  name: 'spawn_task',
  description:
    'Suggest spinning off out-of-scope follow-up work into a NEW ClaudeDeck session. ' +
    'Renders a chip the user can accept or dismiss; it does not run anything itself.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short imperative title, e.g. "Fix stale README badge".' },
      prompt: {
        type: 'string',
        description:
          'Self-contained instructions for the new session (it has NO memory of this chat — ' +
          'include file paths and enough detail to act cold).',
      },
      tldr: { type: 'string', description: 'One-line plain-English summary shown on the chip.' },
      cwd: { type: 'string', description: 'Optional working dir; defaults to the current session folder.' },
    },
    required: ['title', 'prompt', 'tldr'],
  },
} as const

export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** Build the synthetic success payload. `now` is injectable for deterministic tests. */
export function buildSpawnTaskCallResult(
  args: { title?: string; prompt?: string; tldr?: string; cwd?: string },
  now: number = Date.now(),
): ToolCallResult {
  const title = typeof args?.title === 'string' && args.title.trim() ? args.title.trim() : 'task'
  const taskId = `task_${now.toString(36)}`
  return {
    content: [
      {
        type: 'text',
        text: `Recorded suggestion "${title}" (${taskId}). The user will see a chip to spawn it into a new session.`,
      },
    ],
  }
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown>; [k: string]: unknown }
}

/**
 * Handle one JSON-RPC message. Returns the response object to write back, or
 * `null` for notifications (no `id`) and anything we intentionally drop.
 */
export function dispatch(msg: JsonRpcMessage): object | null {
  const { id, method } = msg
  // Notifications carry no id and expect no response.
  if (id === undefined || id === null) return null

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'claudedeck', version: '1.0.0' },
        },
      }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: [SPAWN_TASK_TOOL_DEF] } }
    case 'tools/call': {
      if (msg.params?.name === 'spawn_task') {
        return { jsonrpc: '2.0', id, result: buildSpawnTaskCallResult(msg.params.arguments ?? {}) }
      }
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${msg.params?.name}` } }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
  }
}

/** Run the stdio loop. Only invoked when this file is the process entry. */
function runServer(): void {
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage
    } catch {
      return // ignore malformed lines
    }
    const res = dispatch(msg)
    if (res) process.stdout.write(JSON.stringify(res) + '\n')
  })
}

// Run only when launched directly (claude spawns this as the MCP server entry).
// When imported by the test runner, `require.main !== module`, so the loop stays off.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  runServer()
}
```

- [ ] `npx vitest run electron/mcp/spawnTaskServer.test.ts` → green.

---

### Task 3 — config writer (copy server + write mcp-config, non-fatal)

**File:** `electron/mcp/spawnTaskConfig.test.ts` (new)
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeSpawnTaskMcpConfig } from './spawnTaskConfig'

let dir: string
let serverSrc: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cdk-mcp-'))
  serverSrc = join(dir, 'spawnTaskServer.js')
  writeFileSync(serverSrc, '// server', 'utf8')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('writeSpawnTaskMcpConfig', () => {
  it('copies the server and writes a config pointing the claudedeck server at execPath', () => {
    const cfgPath = writeSpawnTaskMcpConfig(dir, serverSrc, 'C:/electron.exe')
    expect(cfgPath).toBeTruthy()
    expect(existsSync(join(dir, 'mcp', 'spawnTaskServer.js'))).toBe(true)
    const cfg = JSON.parse(readFileSync(cfgPath!, 'utf8'))
    const srv = cfg.mcpServers.claudedeck
    expect(srv.command).toBe('C:/electron.exe')
    expect(srv.args[0]).toBe(join(dir, 'mcp', 'spawnTaskServer.js'))
    expect(srv.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('returns undefined (non-fatal) when the server source is missing', () => {
    expect(writeSpawnTaskMcpConfig(dir, join(dir, 'nope.js'), 'C:/electron.exe')).toBeUndefined()
  })
})
```

**File:** `electron/mcp/spawnTaskConfig.ts` (new)
```ts
/**
 * Write the spawn-task MCP config under userData and copy the built server next to
 * it (real disk, never inside asar). Returns the config-file path, or `undefined`
 * on any failure — injection is best-effort and must NEVER break a turn (the chip
 * still renders from the tool_use block even with no working server).
 *
 * The config launches the server via the Electron binary with
 * ELECTRON_RUN_AS_NODE=1, so no system `node` is required.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function writeSpawnTaskMcpConfig(
  userDataDir: string,
  serverSrcPath: string,
  execPath: string,
): string | undefined {
  try {
    if (!existsSync(serverSrcPath)) return undefined
    const mcpDir = join(userDataDir, 'mcp')
    mkdirSync(mcpDir, { recursive: true })

    const serverDest = join(mcpDir, 'spawnTaskServer.js')
    copyFileSync(serverSrcPath, serverDest)

    const config = {
      mcpServers: {
        claudedeck: {
          command: execPath,
          args: [serverDest],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
      },
    }
    const cfgPath = join(mcpDir, 'claudedeck-mcp.json')
    writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8')
    return cfgPath
  } catch {
    return undefined // non-fatal
  }
}
```

- [ ] `npx vitest run electron/mcp/spawnTaskConfig.test.ts` → green.

---

### Task 4 — `buildArgs` injects the three flags

**File:** `electron/claude.test.ts` (modify)

- [ ] Add a `describe('buildArgs — spawn_task injection')` block. `setSpawnTaskMcpConfig`
  is a module setter; set it in the block and reset after.

```ts
import { buildArgs, /* …existing… */ setSpawnTaskMcpConfig, SPAWN_TASK_TOOL } from './claude'

describe('buildArgs — spawn_task injection', () => {
  afterEach(() => setSpawnTaskMcpConfig(undefined))

  it('always appends the spawn_task system prompt and allowlists the tool', () => {
    const args = buildArgs(base)
    expect(args).toContain('--append-system-prompt')
    const ai = args.indexOf('--allowedTools')
    expect(ai).toBeGreaterThanOrEqual(0)
    expect(args.slice(ai + 1)).toContain(SPAWN_TASK_TOOL)
  })

  it('merges the spawn_task token after the user allow rules', () => {
    const args = buildArgs({ ...base, allowedTools: ['Edit', 'Bash(git *)'] })
    const ai = args.indexOf('--allowedTools')
    const allow = args.slice(ai + 1).filter((t) => !t.startsWith('--'))
    expect(allow).toContain('Edit')
    expect(allow).toContain('Bash(git *)')
    expect(allow).toContain(SPAWN_TASK_TOOL)
  })

  it('adds --mcp-config only when a config path is set', () => {
    expect(buildArgs(base)).not.toContain('--mcp-config')
    setSpawnTaskMcpConfig('C:/Users/x/AppData/Roaming/claudedeck/mcp/claudedeck-mcp.json')
    const args = buildArgs(base)
    const i = args.indexOf('--mcp-config')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('C:/Users/x/AppData/Roaming/claudedeck/mcp/claudedeck-mcp.json')
  })

  it('drops --mcp-config when the path contains % (CRIT-1 quoteForCmd)', () => {
    setSpawnTaskMcpConfig('C:/Users/%evil%/mcp.json')
    expect(buildArgs(base)).not.toContain('--mcp-config')
  })
})
```

- [ ] **Replace (don't duplicate)** the existing `'emits --allowedTools / --disallowedTools as
  separate tokens, skips when empty'` test (≈ line 144-161): delete the old `it(...)` block
  entirely and put this in its place. `--allowedTools` is **no longer skipped when empty** — it
  now always carries the spawn token (the old line-145 `not.toContain('--allowedTools')` must go):

```ts
  it('emits --allowedTools / --disallowedTools as separate tokens', () => {
    // allowedTools is ALWAYS present now (carries the spawn_task token); disallowed is still optional.
    expect(buildArgs(base)).toContain('--allowedTools')
    expect(buildArgs(base)).not.toContain('--disallowedTools')
    const a = buildArgs({
      ...base,
      allowedTools: ['Bash(git *)', 'Edit', '  '],
      disallowedTools: ['WebFetch'],
    })
    const ai = a.indexOf('--allowedTools')
    expect(ai).toBeGreaterThanOrEqual(0)
    expect(a[ai + 1]).toBe('Bash(git *)')
    expect(a[ai + 2]).toBe('Edit')
    expect(a).not.toContain('  ') // empty rule dropped
    const di = a.indexOf('--disallowedTools')
    expect(di).toBeGreaterThanOrEqual(0)
    expect(a[di + 1]).toBe('WebFetch')
  })
```

- [ ] Run `npx vitest run electron/claude.test.ts` → RED (functions missing / old behavior).

**File:** `electron/claude.ts` (modify)

- [ ] Add constants + setter near the other exported helpers (after `toCliMode`, ≈ line 194):

```ts
/** Wire name of the injected MCP tool (server `claudedeck` + tool `spawn_task`). MUST
 *  match the renderer detector in src/renderer/cli/blockMapping.ts (SPAWN_TASK_TOOL_NAME). */
export const SPAWN_TASK_TOOL = 'mcp__claudedeck__spawn_task'

/** Appended to every turn so the model knows the tool exists and when to use it.
 *  ASCII only, no `%` (Windows quoteForCmd rejects `%`). */
export const SPAWN_TASK_SYSTEM_PROMPT =
  'You have a spawn_task tool. When you notice out-of-scope follow-up work worth doing ' +
  'separately - dead code, stale docs, a bug in unrelated code, missing test coverage - that ' +
  'would bloat the current change, call spawn_task with a self-contained prompt (the new ' +
  'session has no memory of this conversation; include file paths and enough detail to act ' +
  'cold), a short imperative title, and a one-line tldr. The user sees a chip and decides ' +
  'whether to spin it into a new session. Do NOT call it for vague observations, trivial ' +
  'inline fixes, or anything that needs this conversation to understand.'

/** Set by main.ts at startup once the mcp-config file is written; undefined disables
 *  --mcp-config injection (the chip still works via tool_use detection). */
let spawnTaskMcpConfigPath: string | undefined
export function setSpawnTaskMcpConfig(path: string | undefined): void {
  spawnTaskMcpConfigPath = path
}
```

- [ ] In `buildArgs`, replace the `allow` handling and add the injected flags. Change the
  `const allow = ...` usage and the return array:

```ts
  const allow = cleanRules(a.allowedTools)
  // The spawn_task tool is allowlisted in EVERY turn/mode so it never prompts (non-blocking).
  const allowWithSpawn = [...allow, SPAWN_TASK_TOOL]
  // Inject --mcp-config only with a set, %-free path (quoteForCmd rejects %; non-fatal otherwise).
  const mcpConfig =
    spawnTaskMcpConfigPath && !spawnTaskMcpConfigPath.includes('%') ? spawnTaskMcpConfigPath : undefined
```

  Then in the returned array, replace the old `...(allow.length ? ['--allowedTools', ...allow] : [])`
  line with the always-present list, and append the two/three new flags **at the end** (keeps
  every existing positional assertion valid):

```ts
    ...['--allowedTools', ...allowWithSpawn],
    ...(deny.length ? ['--disallowedTools', ...deny] : []),
    ...(dirs.length ? ['--add-dir', ...dirs] : []),
    ...(settingsJson ? ['--settings', settingsJson] : []),
    ...(settingSources ? ['--setting-sources', settingSources] : []),
    ...(sessionId ? ['--resume', sessionId] : []),
    ...(sessionId && a.forkSession ? ['--fork-session'] : []),
    // spawn_task injection (always: system prompt; conditional: mcp-config path).
    '--append-system-prompt', SPAWN_TASK_SYSTEM_PROMPT,
    ...(mcpConfig ? ['--mcp-config', mcpConfig] : []),
```

- [ ] Run `npx vitest run electron/claude.test.ts` → green. Confirm no other existing test
  regressed (especially the prompt-not-in-argv test — injected strings are `%`/`&`-free).

---

### Task 5 — block detector maps the tool to a chip part

**File:** `src/renderer/cli/blockMapping.test.ts` (new)
```ts
import { describe, it, expect } from 'vitest'
import { blockToPart, SPAWN_TASK_TOOL_NAME } from './blockMapping'
import type { ToolUseBlock } from './types'

const toolUse = (input: unknown): ToolUseBlock => ({
  type: 'tool_use', id: 'tu_1', name: SPAWN_TASK_TOOL_NAME, input,
})

describe('blockToPart — spawn_task chip detection', () => {
  it('maps a spawn_task tool_use to a spawn-chip part (not a tool card)', () => {
    const part = blockToPart(toolUse({ title: 'Fix docs', prompt: 'Update README', tldr: 'docs' }), 'running')
    expect(part).toEqual({
      kind: 'spawn-chip',
      chip: { toolUseId: 'tu_1', title: 'Fix docs', prompt: 'Update README', tldr: 'docs', cwd: undefined },
    })
  })

  it('carries an explicit cwd through', () => {
    const part = blockToPart(toolUse({ title: 't', prompt: 'p', tldr: 'x', cwd: 'D:/other' }), 'done')
    expect(part).toMatchObject({ kind: 'spawn-chip', chip: { cwd: 'D:/other' } })
  })

  it('renders NO chip when prompt is missing or blank', () => {
    expect(blockToPart(toolUse({ title: 't', tldr: 'x' }), 'running')).toBeNull()
    expect(blockToPart(toolUse({ title: 't', prompt: '   ', tldr: 'x' }), 'running')).toBeNull()
  })

  it('falls back to a sensible title when title is missing', () => {
    const part = blockToPart(toolUse({ prompt: 'p', tldr: 'x' }), 'running')
    expect(part).toMatchObject({ kind: 'spawn-chip', chip: { title: 'Spawn task' } })
  })

  it('still maps ordinary tools to a tool card', () => {
    const part = blockToPart({ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls' } }, 'running')
    expect(part).toMatchObject({ kind: 'tool', call: { tool: 'Bash' } })
  })
})
```

**File:** `src/renderer/cli/blockMapping.ts` (modify)

- [ ] Add the constant and the detection branch. Import `SpawnChipData`.

```ts
import type { MessagePart, ToolStatus, SpawnChipData } from '@/mock/fixtures'
```

```ts
/** Wire name of ClaudeDeck's injected MCP tool. MUST match electron/claude.ts SPAWN_TASK_TOOL. */
export const SPAWN_TASK_TOOL_NAME = 'mcp__claudedeck__spawn_task'

/** Parse a spawn_task tool_use input into chip data; null when there's no usable prompt. */
export function spawnChipFromInput(id: string, input: unknown): SpawnChipData | null {
  const o = (input ?? {}) as Record<string, unknown>
  const prompt = typeof o.prompt === 'string' ? o.prompt : ''
  if (!prompt.trim()) return null
  return {
    toolUseId: id,
    title: typeof o.title === 'string' && o.title.trim() ? o.title : 'Spawn task',
    prompt,
    tldr: typeof o.tldr === 'string' ? o.tldr : '',
    cwd: typeof o.cwd === 'string' && o.cwd ? o.cwd : undefined,
  }
}
```

  In `blockToPart`, the `case 'tool_use'` becomes:

```ts
    case 'tool_use': {
      if (block.name === SPAWN_TASK_TOOL_NAME) {
        const chip = spawnChipFromInput(block.id, block.input)
        return chip ? { kind: 'spawn-chip', chip } : null
      }
      return {
        kind: 'tool',
        call: { id: block.id, tool: block.name, label: toolLabel(block.name, block.input), status, input: block.input },
      }
    }
```

- [ ] Run `npx vitest run src/renderer/cli/blockMapping.test.ts` → green. The `foldEvent`
  `null` path already skips null parts; the synthetic tool_result (user event) leaves
  `spawn-chip` parts untouched (it only rewrites `kind:'tool'`). No streamMapper change needed.
  Note: `transcriptParser.ts` (≈ line 41) calls the **same** `blockToPart`, so resumed/replayed
  sessions emit identical `spawn-chip` parts automatically (the spec's "stable across transcript
  re-parse" — `applyToolResults` also early-returns for non-`tool` parts). No transcriptParser edit.

---

### Task 6 — pure chip logic (cwd resolve + status map)

**File:** `src/renderer/views/chat/spawnChipLogic.test.ts` (new)
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveSpawnCwd, canAct, getChipStatus, setChipStatus, resetChipStatuses,
} from './spawnChipLogic'

beforeEach(() => resetChipStatuses())

describe('resolveSpawnCwd', () => {
  it('prefers the chip cwd, falls back to the session cwd', () => {
    expect(resolveSpawnCwd('D:/chip', 'D:/session')).toBe('D:/chip')
    expect(resolveSpawnCwd(undefined, 'D:/session')).toBe('D:/session')
    expect(resolveSpawnCwd('', 'D:/session')).toBe('D:/session')
  })
})

describe('canAct', () => {
  it('only pending chips have active buttons', () => {
    expect(canAct('pending')).toBe(true)
    expect(canAct('spawned')).toBe(false)
    expect(canAct('dismissed')).toBe(false)
  })
})

describe('status map (per-session, in-memory, keyed by toolUseId)', () => {
  it('defaults to pending and round-trips set/get', () => {
    expect(getChipStatus('tu_1')).toBe('pending')
    setChipStatus('tu_1', 'spawned')
    expect(getChipStatus('tu_1')).toBe('spawned')
  })

  it('reset clears all statuses (simulates app restart)', () => {
    setChipStatus('tu_1', 'dismissed')
    resetChipStatuses()
    expect(getChipStatus('tu_1')).toBe('pending')
  })
})
```

**File:** `src/renderer/views/chat/spawnChipLogic.ts` (new)
```ts
/**
 * Pure logic + in-memory state for spawn_task chips. Status is keyed by the
 * tool_use id (globally unique, so this doubles as per-session), lives only in
 * module memory, and resets on app restart (reload) — matching the Claude app,
 * where spawn_task ids are not persisted. Kept out of the .tsx so it's unit-tested
 * without a DOM (the repo has no RTL/jsdom).
 */
export type ChipStatus = 'pending' | 'spawned' | 'dismissed'

/** The folder the spawned session opens in: explicit chip cwd, else the session's. */
export function resolveSpawnCwd(chipCwd: string | undefined, sessionCwd: string): string {
  return chipCwd && chipCwd.trim() ? chipCwd : sessionCwd
}

/** Only pending chips have active Spawn/Dismiss buttons (guards double-spawn). */
export function canAct(status: ChipStatus): boolean {
  return status === 'pending'
}

const statusByToolUseId = new Map<string, ChipStatus>()

export function getChipStatus(toolUseId: string): ChipStatus {
  return statusByToolUseId.get(toolUseId) ?? 'pending'
}
export function setChipStatus(toolUseId: string, status: ChipStatus): void {
  statusByToolUseId.set(toolUseId, status)
}
/** Test-only: clear all statuses (also documents the app-restart reset semantics). */
export function resetChipStatuses(): void {
  statusByToolUseId.clear()
}
```

- [ ] Run `npx vitest run src/renderer/views/chat/spawnChipLogic.test.ts` → green.

---

### Task 7 — `SpawnChip.tsx` (view + context)

**File:** `src/renderer/views/chat/SpawnChip.tsx` (new)
```tsx
import { createContext, useContext, useState } from 'react'
import { GitBranchPlus, ArrowUpRight, X } from 'lucide-react'
import type { SpawnChipData } from '@/mock/fixtures'
import {
  type ChipStatus, canAct, getChipStatus, setChipStatus, resolveSpawnCwd,
} from './spawnChipLogic'

/**
 * Provides the spawn action + the current session's cwd to chips rendered deep in
 * the (memoized) message tree. Context bypasses React.memo, so AssistantMessage
 * stays memoized while chips still reach spawnTask. Default is a no-op so a chip
 * never crashes if rendered outside a provider.
 */
export interface SpawnContextValue {
  onSpawn: (prompt: string, cwd?: string) => void
  sessionCwd: string
}
export const SpawnContext = createContext<SpawnContextValue>({ onSpawn: () => {}, sessionCwd: '' })

export function SpawnChip({ chip }: { chip: SpawnChipData }): JSX.Element | null {
  const { onSpawn, sessionCwd } = useContext(SpawnContext)
  const [status, setStatus] = useState<ChipStatus>(() => getChipStatus(chip.toolUseId))

  const update = (s: ChipStatus): void => {
    setChipStatus(chip.toolUseId, s)
    setStatus(s)
  }
  const handleSpawn = (): void => {
    if (!canAct(status)) return
    onSpawn(chip.prompt, resolveSpawnCwd(chip.cwd, sessionCwd))
    update('spawned')
  }
  const handleDismiss = (): void => {
    if (!canAct(status)) return
    update('dismissed')
  }

  if (status === 'dismissed') return null

  const active = canAct(status)
  return (
    <div
      role="group"
      aria-label={`Suggested task: ${chip.title}`}
      className="my-2 rounded-lg border border-accent/30 bg-accent/10 p-3"
    >
      <div className="flex items-start gap-2">
        <GitBranchPlus size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">{chip.title}</div>
          {chip.tldr && <div className="mt-0.5 text-xs text-fg-muted">{chip.tldr}</div>}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {active ? (
          <>
            <button
              type="button"
              onClick={handleSpawn}
              aria-label={`Spawn a new session: ${chip.title}`}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <ArrowUpRight size={13} aria-hidden="true" />
              Spawn
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={`Dismiss suggested task: ${chip.title}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <X size={13} aria-hidden="true" />
              Dismiss
            </button>
          </>
        ) : (
          <span className="text-xs text-fg-muted" aria-live="polite">Opened in a new tab →</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] No render test (no RTL). Logic is covered by Task 6. `npm run typecheck` must pass.

---

### Task 8 — render `spawn-chip` parts in `AssistantMessage`

**File:** `src/renderer/views/chat/AssistantMessage.tsx` (modify)

- [ ] Import the chip and render the new part kind in the `parts.map` (≈ line 100):

```ts
import { SpawnChip } from './SpawnChip'
```

```ts
          if (part.kind === 'thinking') {
            return <ThinkingBlock key={i} text={part.text} />
          }
          if (part.kind === 'spawn-chip') {
            return <SpawnChip key={part.chip.toolUseId} chip={part.chip} />
          }
          return null
```

- [ ] Add the chip to `speakableText` (a11y — blind-first), ≈ line 57:

```ts
        if (part.kind === 'spawn-chip') return `Suggested follow-up task: ${part.chip.title}.`
```

  (`copyableText` intentionally omits the chip — it's UI chrome, not answer prose.)

- [ ] `npm run typecheck` → passes (union now handled).

---

### Task 9 — wire `SpawnContext` through `ChatView` + `App`

**File:** `src/renderer/views/chat/ChatView.tsx` (modify)

> Note: `ChatView` has **no named props interface** — props are an inline destructure (lines
> 10-26) typed by an inline object literal (lines 27-46). Two edit sites: add `onSpawnTask` to
> **both** the destructure list and the inline type.

- [ ] Add the prop and provider. Import `useMemo`, `SpawnContext`.

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { SpawnContext } from './SpawnChip'
```

  Add to the inline destructure (with `onFork`, `th`, etc.): `onSpawnTask,`
  Add to the inline props type literal:
```ts
  /** Open a new tab in the given folder seeded with `prompt` (assistant spawn_task chip). */
  onSpawnTask?: (prompt: string, cwd?: string) => void
```

- [ ] Wrap the message list in the provider (value memoized on its inputs):

```ts
  const spawnCtx = useMemo(
    () => ({ onSpawn: onSpawnTask ?? (() => {}), sessionCwd: session.cwd }),
    [onSpawnTask, session.cwd],
  )
```
  …and wrap just the `session.messages.map(...)` block:
```tsx
              <SpawnContext.Provider value={spawnCtx}>
                {session.messages.map((msg) =>
                  msg.role === 'user' ? (
                    <UserMessage key={msg.id} message={msg} />
                  ) : (
                    <AssistantMessage key={msg.id} message={msg} />
                  )
                )}
              </SpawnContext.Provider>
```

**File:** `src/renderer/App.tsx` (modify)

- [ ] Pass `spawnTask` to the `ChatView` instance (render site ≈ lines 944-961): add
  `onSpawnTask={spawnTask}`. `spawnTask(seed, cwd)` already matches `(prompt, cwd?)`. This is a
  **distinct** prop from the existing `onSpawn={(text) => spawnTask(text)}` that feeds the
  Composer's manual fork button — no collision.
- [ ] *(Optional, cheap)* wrap `spawnTask` in `useCallback` so the memoized `SpawnContext` value
  is stable across renders. LOW severity: `AssistantMessage` is memoized on `message` and does
  not consume the context, so only the few live `SpawnChip`s re-render — acceptable to skip.

- [ ] `npm run typecheck` → passes.

---

### Task 10 — startup wiring (main.ts + vite build input)

**File:** `electron.vite.config.ts` (modify)

- [ ] Add the server as a second main input so it builds to `out/main/spawnTaskServer.js`:

```ts
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('electron/main.ts'),
          spawnTaskServer: resolve('electron/mcp/spawnTaskServer.ts'),
        },
      },
    },
  },
```

**File:** `electron/main.ts` (modify)

- [ ] Import the writer + setter:
```ts
import { detectClaude, startTurn, cancelTurn, cancelAllTurns, respondPermission, setSpawnTaskMcpConfig } from './claude'
import { writeSpawnTaskMcpConfig } from './mcp/spawnTaskConfig'
```

- [ ] In `app.whenReady().then(() => { ... })`, before `createMainWindow()`, wire the config
  (best-effort; the writer already swallows errors and returns undefined):
```ts
  // Inject ClaudeDeck's spawn_task MCP tool into every inner-CLI turn (best-effort).
  setSpawnTaskMcpConfig(
    writeSpawnTaskMcpConfig(
      app.getPath('userData'),
      join(__dirname, 'spawnTaskServer.js'),
      process.execPath,
    ),
  )
```

- [ ] `npm run build` (electron-vite) → confirm `out/main/spawnTaskServer.js` is emitted.

---

### Final verification (run all before claiming done)
- [ ] `npm test` (vitest run) — full suite green, including the updated `claude.test.ts`.
- [ ] `npm run typecheck` — clean.
- [ ] `npm run build` — electron-vite build succeeds; `out/main/spawnTaskServer.js` exists.
- [ ] Manual smoke (**mandatory** — only gate for the Task-0 CLI assumptions): start app, prompt
  the assistant with a task that has an obvious out-of-scope follow-up; confirm a chip renders,
  **Spawn** opens a new same-folder tab seeded with the prompt, **Dismiss** hides it, a normal
  turn with no suggestion is unaffected, and a turn in **`plan` mode** still completes. If Task 0
  was skipped, explicitly test a broken/exited MCP server here and confirm the turn still finishes.
- [ ] Commit (conventional, no `--no-verify`): `feat: assistant-suggested spawn_task chip`.

### Risks / notes
- **Existing `claude.test.ts` allowedTools test changes** — intended (the token is always present now).
- **`require.main === module` after bundling** — the server is its own rollup entry chunk, so the
  guard is true when launched directly and false under vitest import. If a future bundling change
  breaks this, the loop simply won't auto-run (tests still pass; only live injection regresses) —
  catchable by the manual smoke step.
- **Packaged asar** — the server is copied to userData (real disk) before launch, so the external
  CLI never reads inside asar. The copy source is read by the main process, which has asar support.
