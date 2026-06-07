# P2 — Real `claude` CLI Backend (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spawn the real `claude` CLI per turn, parse its `stream-json` events, and render the streaming reply (text + tool cards + terminal log) into the existing chat/terminal UI instead of mock data — fully operable by voice and keyboard for a blind user.

**Architecture:** A single `useSessions` reducer (seeded from the `SESSIONS` fixture) becomes the mutable spine. A pure `foldEvent` mapper folds `claude` stream-json events into `ChatMessage.parts[]`. The Electron main process spawns `claude -p --output-format stream-json` over stdout pipes (the existing Miku `spawn`/`taskkill` pattern; **no node-pty, no `shell:true`**) and forwards events via IPC. The renderer's `claudeClient` subscribes per-turn and dispatches into the reducer. Accessibility (send-by-voice, spoken status via `speakSmart`, read-the-live-reply) is wired in the same slice.

**Tech Stack:** electron-vite, React 18 + TS (strict), Tailwind v3.4, `child_process.spawn`, **vitest** (added in Task 1), existing `speakSmart`/`dispatchCommand`/`VoiceCommand` voice machinery.

**Deviation from spec (recorded):** the design's argv includes `--include-partial-messages` (token-level deltas). Slice A **drops** that flag. Message-level `assistant`/`user`/`result` events already make parts appear progressively (text → tool card → text), which reads as streaming, and they fold deterministically with no delta/final duplication — keeping `foldEvent` pure and unit-testable. Token-level deltas + auto-read-while-streaming move to Slice C, where the flag can be re-added behind the same mapper.

**Decisions locked from the design (`docs/superpowers/specs/2026-06-08-p2-claude-cli-backend-design.md`):** headless `stream-json`; claude-first with an adapter seam; `--permission-mode` user-selectable, default `plan`; per-turn spawn + `--resume <session_id>`; cancel = kill the process tree.

---

## File Structure

**New files**
- `vitest.config.ts` — vitest config sharing the `@` alias (Task 1).
- `src/renderer/settings/voiceCommands.test.ts` — natural-sentence command-matching tests (Task 13).
- `src/renderer/cli/types.ts` — TS types for the consumed `claude` stream-json events (Task 5).
- `src/renderer/cli/streamMapper.ts` — **pure, exported, unit-tested** `foldEvent(message, event) → FoldResult`; the 80% coverage anchor (Task 6).
- `src/renderer/cli/streamMapper.test.ts` — mapper tests against captured/hand-authored event arrays (Task 6).
- `src/renderer/cli/claudeClient.ts` — thin renderer wrapper over `window.claudedeck.claude` (Task 9).
- `src/renderer/state/useSessions.ts` — `sessionsReducer` (pure) + `useSessions` hook (Tasks 3–4).
- `src/renderer/state/useSessions.test.ts` — reducer transition tests (Task 3).
- `electron/claude.ts` — `detectClaude` / `startTurn` / `cancelTurn` in the main process (Task 7).

**Modified files**
- `src/renderer/mock/fixtures.ts` — add `terminalLines` + `claudeSessionId` to `Session`; seed existing sessions (Task 2).
- `electron/main.ts` — register `claude:*` IPC; kill turns on quit (Task 8).
- `electron/preload.ts` — add the `claude` surface mirroring `miku` (Task 8).
- `src/renderer/views/chat/Composer.tsx` — `onSend` prop + imperative `submit()` + lift `modelId` (Task 10).
- `src/renderer/views/chat/ChatView.tsx` — thread `onSend` + composer ref (Task 10).
- `src/renderer/views/terminal/TerminalOutput.tsx` — accept `lines` prop (Task 11).
- `src/renderer/layout/BottomPanel.tsx` — thread `lines` to `TerminalOutput` (Task 11).
- `src/renderer/settings/voiceCommands.ts` — `dispatchCommand` longest-match (natural-sentence robust) (Task 13).
- `src/renderer/layout/StatusBar.tsx` — Live/Mock toggle + permission-mode dropdown, voice/keyboard reachable (Task 12).
- `src/renderer/App.tsx` — render from `useSessions`; `handleSend` (mock + live); subscribe to events; spoken status + aria-live; `"ส่ง"` command; point `"อ่าน"` at live state; live/mock + permission voice commands (Tasks 4, 11, 12, 13).

---

## Task 1: Test infrastructure (vitest)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (devDependencies + `test` scripts)

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest@^2.1.8
```

- [ ] **Step 2: Create the vitest config (shares the `@` alias, node env)**

Create `vitest.config.ts`:

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': resolve('src/renderer') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/renderer/cli/**', 'src/renderer/state/**'] },
  },
})
```

- [ ] **Step 3: Add test scripts**

In `package.json` `scripts`, add after `"typecheck"`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4: Smoke-test the runner**

Create a throwaway `src/renderer/_smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
describe('smoke', () => {
  it('runs', () => expect(1 + 1).toBe(2))
})
```

Run: `npx vitest run`
Expected: PASS, 1 test.

- [ ] **Step 5: Delete the smoke test, verify typecheck**

```bash
rm src/renderer/_smoke.test.ts
npm run typecheck
```
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -F - <<'EOF'
test: add vitest runner + config for P2 reducer/mapper tests
EOF
```

---

## Task 2: Extend the `Session` data contract

The reducer needs a mutable per-session terminal log and a place to store `claude`'s `session_id` for `--resume`.

**Files:**
- Modify: `src/renderer/mock/fixtures.ts` (Session interface `:90-102`; SESSIONS seed `:311-349`)

- [ ] **Step 1: Add fields to the `Session` interface**

In `src/renderer/mock/fixtures.ts`, replace the `Session` interface (lines 90-102) with:

```ts
export interface Session {
  id: string
  title: string
  /** Project / working directory shown in the tab + sidebar. */
  cwd: string
  status: SessionStatus
  model: string
  /** ISO timestamp of last activity. */
  updatedAt: string
  /** Cumulative token count for the session. */
  tokens: number
  messages: ChatMessage[]
  /** Live terminal/event log for this session (empty until a live turn runs). */
  terminalLines: TerminalLine[]
  /** claude CLI session id captured from the init event, used for --resume. */
  claudeSessionId?: string
}
```

- [ ] **Step 2: Seed the existing sessions**

`TerminalLine` is declared at `:179` (before `SESSIONS` at `:311`), so it is in scope. In the `SESSIONS` array, add `terminalLines` to each session:
- `s1`: `terminalLines: TERMINAL_LINES,` — **but** `TERMINAL_LINES` is declared *after* `SESSIONS` (line 501). Move the `TERMINAL_LINES` declaration (lines 501-512) to **above** `export const SESSIONS` (just before line 311), then reference it in `s1`.
- `s2` and `s3`: `terminalLines: [],`

After moving, `s1` ends:
```ts
    tokens: 48210,
    messages: chatMessages,
    terminalLines: TERMINAL_LINES,
  },
```
and `s2`/`s3` each get `terminalLines: [],` after their `messages` field.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. (Any view reading `session.terminalLines` later is added in Task 11; this step only adds the optional/array fields, which are backward-compatible.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/mock/fixtures.ts
git commit -F - <<'EOF'
feat(contract): add terminalLines + claudeSessionId to Session
EOF
```

---

## Task 3: `sessionsReducer` (pure) + tests — **the spine**

This is the headline task: turn the static `SESSIONS` import into a mutable reducer. The reducer is pure (IDs/timestamps passed in by the caller) so it is fully unit-testable.

**Files:**
- Create: `src/renderer/state/useSessions.ts` (reducer half only in this task)
- Test: `src/renderer/state/useSessions.test.ts`

- [ ] **Step 1: Write the failing reducer tests**

Create `src/renderer/state/useSessions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sessionsReducer, initialSessionsState, type SessionsState } from './useSessions'
import type { ChatMessage } from '@/mock/fixtures'

const userMsg: ChatMessage = {
  id: 'u1', role: 'user', createdAt: '2026-06-08T00:00:00Z',
  parts: [{ kind: 'markdown', text: 'hello' }],
}
const asstMsg: ChatMessage = {
  id: 'a1', role: 'assistant', createdAt: '2026-06-08T00:00:01Z', parts: [], streaming: true,
}

function stateWithSession(id: string): SessionsState {
  return {
    sessions: [
      { id, title: 't', cwd: 'D:/p', status: 'idle', model: 'Opus 4.8',
        updatedAt: '', tokens: 0, messages: [], terminalLines: [] },
    ],
  }
}

describe('sessionsReducer', () => {
  it('seeds from the SESSIONS fixture', () => {
    expect(initialSessionsState().sessions.length).toBeGreaterThan(0)
  })

  it('startTurn appends the user + empty assistant message', () => {
    const s0 = stateWithSession('x')
    const s1 = sessionsReducer(s0, {
      type: 'startTurn', sessionId: 'x', userMessage: userMsg, assistantMessage: asstMsg,
    })
    expect(s1.sessions[0].messages.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(s1.sessions[0].messages[1].streaming).toBe(true)
    // immutability: original untouched
    expect(s0.sessions[0].messages.length).toBe(0)
  })

  it('event folds into the streaming assistant message and captures the session id', () => {
    let s = stateWithSession('x')
    s = sessionsReducer(s, { type: 'startTurn', sessionId: 'x', userMessage: userMsg, assistantMessage: asstMsg })
    s = sessionsReducer(s, {
      type: 'event', sessionId: 'x',
      event: { type: 'system', subtype: 'init', session_id: 'claude-123', model: 'opus', cwd: 'D:/p', tools: [] },
    })
    s = sessionsReducer(s, {
      type: 'event', sessionId: 'x',
      event: { type: 'assistant', session_id: 'claude-123',
        message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'hi there' }] } },
    })
    expect(s.sessions[0].claudeSessionId).toBe('claude-123')
    const last = s.sessions[0].messages[1]
    expect(last.parts).toEqual([{ kind: 'markdown', text: 'hi there' }])
  })

  it('terminal appends a capped log line', () => {
    let s = stateWithSession('x')
    s = sessionsReducer(s, { type: 'terminal', sessionId: 'x', line: { id: 'l1', kind: 'stdout', text: 'boot' } })
    expect(s.sessions[0].terminalLines).toEqual([{ id: 'l1', kind: 'stdout', text: 'boot' }])
  })

  it('finishTurn clears streaming on the active message', () => {
    let s = stateWithSession('x')
    s = sessionsReducer(s, { type: 'startTurn', sessionId: 'x', userMessage: userMsg, assistantMessage: asstMsg })
    s = sessionsReducer(s, { type: 'finishTurn', sessionId: 'x' })
    expect(s.sessions[0].messages[1].streaming).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/state/useSessions.test.ts`
Expected: FAIL — `Cannot find module './useSessions'`.

- [ ] **Step 3: Write the reducer (and re-export `foldEvent` dependency stub)**

Create `src/renderer/state/useSessions.ts` (reducer half — the `useSessions` hook is added in Task 4):

```ts
import type { ChatMessage, Session, TerminalLine } from '@/mock/fixtures'
import { SESSIONS } from '@/mock/fixtures'
import { foldEvent } from '@/cli/streamMapper'
import type { ClaudeEvent } from '@/cli/types'

const MAX_TERMINAL_LINES = 500

export interface SessionsState {
  sessions: Session[]
}

export type SessionsAction =
  | { type: 'startTurn'; sessionId: string; userMessage: ChatMessage; assistantMessage: ChatMessage }
  | { type: 'event'; sessionId: string; event: ClaudeEvent }
  | { type: 'terminal'; sessionId: string; line: TerminalLine }
  | { type: 'finishTurn'; sessionId: string }

export function initialSessionsState(): SessionsState {
  // Deep-ish clone so the reducer never mutates the shared fixture import.
  return { sessions: SESSIONS.map((s) => ({ ...s, messages: [...s.messages], terminalLines: [...s.terminalLines] })) }
}

function patchSession(state: SessionsState, id: string, fn: (s: Session) => Session): SessionsState {
  return { sessions: state.sessions.map((s) => (s.id === id ? fn(s) : s)) }
}

export function sessionsReducer(state: SessionsState, action: SessionsAction): SessionsState {
  switch (action.type) {
    case 'startTurn':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        status: 'running',
        messages: [...s.messages, action.userMessage, action.assistantMessage],
      }))

    case 'event':
      return patchSession(state, action.sessionId, (s) => {
        const idx = lastStreamingIndex(s.messages)
        if (idx === -1) return s
        const { message, sessionId } = foldEvent(s.messages[idx], action.event)
        const messages = [...s.messages]
        messages[idx] = message
        return { ...s, messages, claudeSessionId: sessionId ?? s.claudeSessionId }
      })

    case 'terminal':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        terminalLines: [...s.terminalLines, action.line].slice(-MAX_TERMINAL_LINES),
      }))

    case 'finishTurn':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        status: 'idle',
        messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      }))

    default:
      return state
  }
}

function lastStreamingIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].streaming) return i
  }
  return -1
}
```

> Note: this file imports `@/cli/streamMapper` and `@/cli/types`, which are created in Tasks 5–6. The reducer tests above only exercise `startTurn`/`terminal`/`finishTurn` plus a `system`+`assistant` fold, so those modules must exist for the test to compile. **Implement Task 5 and Task 6 (types + mapper) before running these tests** — or run them after Task 6. If executing strictly in order, move this Task after Task 6. (Recommended order: 1 → 2 → 5 → 6 → 3 → 4 → 7 …; the spine is split only so the *reducer design* is reviewed first.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/state/useSessions.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/state/useSessions.ts src/renderer/state/useSessions.test.ts
git commit -F - <<'EOF'
feat(state): sessionsReducer — mutable session spine (pure, tested)
EOF
```

---

## Task 4: `useSessions` hook + render App from it

Wrap the reducer in a hook and switch `App.tsx` from the static `SESSIONS` import to live state, with **no behavior change yet** (mock still renders).

**Files:**
- Modify: `src/renderer/state/useSessions.ts` (append the hook)
- Modify: `src/renderer/App.tsx` (`:27`, `:37-49`, and the `SESSIONS` usages at `:323`, `:337`)

- [ ] **Step 1: Append the hook to `useSessions.ts`**

Add at the end of `src/renderer/state/useSessions.ts`:

```ts
import { useReducer } from 'react'

export interface UseSessions {
  state: SessionsState
  dispatch: React.Dispatch<SessionsAction>
}

export function useSessions(): UseSessions {
  const [state, dispatch] = useReducer(sessionsReducer, undefined, initialSessionsState)
  return { state, dispatch }
}
```

- [ ] **Step 2: Wire App to the hook (render unchanged)**

In `src/renderer/App.tsx`:

Replace the import at `:27`:
```ts
import { ACTIVE_SESSION_ID, type ActivityId } from '@/mock/fixtures'
import { useSessions } from '@/state/useSessions'
```
(drop `SESSIONS` from the fixture import.)

After `const { settings, update } = useSettings()` (`:30`), add:
```ts
  const { state: sessionsState, dispatch: sessionsDispatch } = useSessions()
  const sessions = sessionsState.sessions
```

Replace `activeSession` (`:37-40`):
```ts
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0],
    [sessions, activeSessionId],
  )
```

Replace `cycleSession` (`:44-49`) — swap both `SESSIONS` for `sessions`:
```ts
  const cycleSession = (dir: 1 | -1): void =>
    setActiveSessionId((cur) => {
      const i = sessions.findIndex((s) => s.id === cur)
      const next = (i + dir + sessions.length) % sessions.length
      return sessions[next].id
    })
```

Replace the two `sessions={SESSIONS}` props (Sidebar `:323`, TabStrip `:337`) with `sessions={sessions}`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds. (Mock data still renders identically — sessions are seeded from the fixture.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/useSessions.ts src/renderer/App.tsx
git commit -F - <<'EOF'
feat(state): useSessions hook — App renders from reducer state
EOF
```

---

## Task 5: `claude` stream-json event types

**Files:**
- Create: `src/renderer/cli/types.ts`

- [ ] **Step 1: Write the types**

Create `src/renderer/cli/types.ts`:

```ts
/**
 * The subset of `claude --output-format stream-json` events ClaudeDeck consumes
 * in Slice A (message-level; token-level partial deltas are Slice C). Shapes
 * verified against `claude --help` (2026-06-08) and a captured event log; see
 * src/renderer/cli/__fixtures__/.
 */

export interface SystemInitEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  model?: string
  cwd?: string
  tools?: string[]
}

export interface TextBlock {
  type: 'text'
  text: string
}
export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input?: unknown
}
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock

export interface AssistantEvent {
  type: 'assistant'
  session_id?: string
  message: {
    id?: string
    role: 'assistant'
    content: ContentBlock[]
  }
}

export type ToolResultContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: string; [k: string]: unknown }>

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: ToolResultContent
  is_error?: boolean
}

export interface UserEvent {
  type: 'user'
  session_id?: string
  message: {
    role: 'user'
    content: ToolResultBlock[]
  }
}

export interface ResultEvent {
  type: 'result'
  subtype?: string
  session_id?: string
  is_error?: boolean
  result?: string
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number }
}

export type ClaudeEvent = SystemInitEvent | AssistantEvent | UserEvent | ResultEvent

/** Wire payloads from the main process (mirror electron/claude.ts). */
export interface ClaudeEventMsg { turnId: string; event: ClaudeEvent }
export interface ClaudeStderrMsg { turnId: string; text: string }
export interface ClaudeDoneMsg { turnId: string; code: number }

export type PermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default'

export interface StartTurnRequest {
  turnId: string
  prompt: string
  cwd: string
  sessionId?: string
  model?: string
  permissionMode: PermissionMode
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/cli/types.ts
git commit -F - <<'EOF'
feat(cli): stream-json event types for Slice A
EOF
```

---

## Task 6: `foldEvent` mapper (pure) + tests — coverage anchor

**Files:**
- Create: `src/renderer/cli/streamMapper.ts`
- Create: `src/renderer/cli/streamMapper.test.ts`
- Create (optional capture): `src/renderer/cli/__fixtures__/hello.jsonl`

- [ ] **Step 1: Write the failing mapper tests**

Create `src/renderer/cli/streamMapper.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { foldEvent, emptyAssistantMessage } from './streamMapper'
import type { ClaudeEvent } from './types'

function fold(events: ClaudeEvent[]) {
  let msg = emptyAssistantMessage('a1', '2026-06-08T00:00:00Z')
  let sessionId: string | undefined
  let finalized = false
  let errored = false
  for (const e of events) {
    const r = foldEvent(msg, e)
    msg = r.message
    sessionId = r.sessionId ?? sessionId
    finalized = r.finalized ?? finalized
    errored = r.errored ?? errored
  }
  return { msg, sessionId, finalized, errored }
}

describe('foldEvent', () => {
  it('captures session_id from the init event', () => {
    const { sessionId } = fold([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
    ])
    expect(sessionId).toBe('sess-1')
  })

  it('folds plain assistant text into a markdown part', () => {
    const { msg } = fold([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] } },
    ])
    expect(msg.parts).toEqual([{ kind: 'markdown', text: 'Hello!' }])
  })

  it('folds a tool_use → tool_result round-trip into a resolved tool card', () => {
    const { msg } = fold([
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'src/app.ts' } },
      ] } },
      { type: 'user', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false },
      ] } },
    ])
    expect(msg.parts).toHaveLength(1)
    expect(msg.parts[0]).toEqual({
      kind: 'tool',
      call: { id: 'tu1', tool: 'Read', label: 'src/app.ts', status: 'done', output: 'file contents' },
    })
  })

  it('marks a tool card errored when tool_result.is_error', () => {
    const { msg } = fold([
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'npm test' } },
      ] } },
      { type: 'user', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu2', content: 'boom', is_error: true },
      ] } },
    ])
    const part = msg.parts[0]
    expect(part.kind === 'tool' && part.call.status).toBe('error')
    expect(part.kind === 'tool' && part.call.label).toBe('npm test')
  })

  it('keeps interleaved order: text, tool, text', () => {
    const { msg } = fold([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 't', name: 'Grep', input: { pattern: 'foo' } }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] } },
    ])
    expect(msg.parts.map((p) => p.kind)).toEqual(['markdown', 'tool', 'markdown'])
  })

  it('folds thinking blocks', () => {
    const { msg } = fold([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] } },
    ])
    expect(msg.parts).toEqual([{ kind: 'thinking', text: 'hmm' }])
  })

  it('finalizes on result and flags errors', () => {
    const ok = fold([{ type: 'result', subtype: 'success', is_error: false, session_id: 's' }])
    expect(ok.finalized).toBe(true)
    expect(ok.errored).toBe(false)
    expect(ok.msg.streaming).toBe(false)

    const bad = fold([{ type: 'result', subtype: 'error_during_execution', is_error: true }])
    expect(bad.errored).toBe(true)
  })

  it('is pure — does not mutate the input message', () => {
    const m0 = emptyAssistantMessage('a', 't')
    foldEvent(m0, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } })
    expect(m0.parts).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/cli/streamMapper.test.ts`
Expected: FAIL — `Cannot find module './streamMapper'`.

- [ ] **Step 3: Write the mapper**

Create `src/renderer/cli/streamMapper.ts`:

```ts
import type { ChatMessage, MessagePart, ToolCall } from '@/mock/fixtures'
import type { ClaudeEvent, ContentBlock, ToolResultContent } from './types'

export interface FoldResult {
  message: ChatMessage
  sessionId?: string
  finalized?: boolean
  errored?: boolean
}

export function emptyAssistantMessage(id: string, createdAt: string): ChatMessage {
  return { id, role: 'assistant', createdAt, parts: [], streaming: true }
}

/** Best-effort short label from a tool's input, falling back to the tool name. */
function toolLabel(name: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>
  for (const k of ['file_path', 'path', 'pattern', 'command', 'url', 'query'] as const) {
    if (typeof o[k] === 'string' && o[k]) return o[k] as string
  }
  return name
}

function blockToPart(block: ContentBlock): MessagePart | null {
  switch (block.type) {
    case 'text':
      return { kind: 'markdown', text: block.text }
    case 'thinking':
      return { kind: 'thinking', text: block.thinking }
    case 'tool_use':
      return {
        kind: 'tool',
        call: { id: block.id, tool: block.name, label: toolLabel(block.name, block.input), status: 'running' },
      }
    default:
      return null
  }
}

function resultText(content: ToolResultContent): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (c.type === 'text' && typeof (c as { text?: string }).text === 'string' ? (c as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** Pure fold: apply one stream-json event to the in-progress assistant message. */
export function foldEvent(message: ChatMessage, event: ClaudeEvent): FoldResult {
  switch (event.type) {
    case 'system':
      return { message, sessionId: event.session_id }

    case 'assistant': {
      const parts = [...message.parts]
      for (const block of event.message.content) {
        const part = blockToPart(block)
        if (part) parts.push(part)
      }
      return { message: { ...message, parts }, sessionId: event.session_id }
    }

    case 'user': {
      const parts = message.parts.map((p): MessagePart => {
        if (p.kind !== 'tool') return p
        const res = event.message.content.find((c) => c.tool_use_id === p.call.id)
        if (!res) return p
        const call: ToolCall = {
          ...p.call,
          status: res.is_error ? 'error' : 'done',
          output: resultText(res.content),
        }
        return { kind: 'tool', call }
      })
      return { message: { ...message, parts }, sessionId: event.session_id }
    }

    case 'result':
      return {
        message: { ...message, streaming: false },
        sessionId: event.session_id,
        finalized: true,
        errored: !!event.is_error,
      }

    default:
      return { message }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/cli/streamMapper.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: (Optional, low-cost) capture a real event log to validate shapes**

Only if a `claude` CLI is installed. From the repo root:
```bash
claude -p "reply with the single word hi" --output-format stream-json --verbose > src/renderer/cli/__fixtures__/hello.jsonl
```
Eyeball the JSON lines against `types.ts`. If a field name differs (e.g. `session_id` vs `sessionId`, or `result` event field names), update `types.ts` + the mapper and re-run the tests. This is a ~5-token call; safe for cost. If no CLI is available, **skip** — the hand-authored fixtures above already exercise every branch.

- [ ] **Step 6: Run the reducer tests from Task 3 now that the mapper exists**

Run: `npx vitest run`
Expected: all reducer + mapper tests PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add src/renderer/cli/streamMapper.ts src/renderer/cli/streamMapper.test.ts src/renderer/cli/__fixtures__ 2>/dev/null
git commit -F - <<'EOF'
feat(cli): foldEvent stream-json mapper (pure, unit-tested)
EOF
```

---

## Task 7: Main process — `electron/claude.ts`

Spawn `claude` over stdout pipes, parse newline-delimited JSON, forward via IPC. Mirrors the Miku `spawn`/`taskkill` pattern in `main.ts`.

**Files:**
- Create: `electron/claude.ts`

- [ ] **Step 1: Write the module**

Create `electron/claude.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { BrowserWindow } from 'electron'

export type PermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default'

export interface StartTurnArgs {
  turnId: string
  prompt: string
  cwd: string
  sessionId?: string
  model?: string
  permissionMode: PermissionMode
}

const turns = new Map<string, ChildProcess>()
let cachedBin: string | null | undefined // undefined = not probed, null = not found

/** Locate the claude binary once. Returns the resolved path, or null. */
export async function detectClaude(): Promise<string | null> {
  if (cachedBin !== undefined) return cachedBin
  cachedBin = await probe()
  return cachedBin
}

function probe(): Promise<string | null> {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const p = spawn(finder, ['claude'], { windowsHide: true })
    let out = ''
    p.stdout?.on('data', (d) => (out += String(d)))
    p.on('error', () => resolve(null))
    p.on('exit', (code) => {
      if (code !== 0) return resolve(null)
      const first = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0]
      resolve(first && existsSync(first) ? first : first || null)
    })
  })
}

function buildArgs(a: StartTurnArgs): string[] {
  return [
    '-p', a.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', a.permissionMode,
    ...(a.model ? ['--model', a.model] : []),
    ...(a.sessionId ? ['--resume', a.sessionId] : []),
  ]
}

/**
 * Spawn one turn. The prompt is passed as a discrete argv element (never string-
 * concatenated), so there is no shell injection even though .cmd on Windows is
 * launched via `cmd.exe /c` (Node quotes each argument).
 */
export async function startTurn(win: BrowserWindow, a: StartTurnArgs): Promise<{ ok: boolean; error?: string }> {
  const bin = await detectClaude()
  if (!bin) return { ok: false, error: 'claude CLI not found' }
  if (a.cwd && !existsSync(a.cwd)) return { ok: false, error: `cwd does not exist: ${a.cwd}` }

  const args = buildArgs(a)
  const isWin = process.platform === 'win32'
  const proc = isWin
    ? spawn('cmd.exe', ['/c', bin, ...args], { cwd: a.cwd, windowsHide: true })
    : spawn(bin, args, { cwd: a.cwd })

  turns.set(a.turnId, proc)

  let buf = ''
  proc.stdout?.on('data', (d) => {
    buf += String(d)
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const event = JSON.parse(line)
        win.webContents.send('claude:event', { turnId: a.turnId, event })
      } catch {
        // Malformed line → surface to the terminal log, never throw.
        win.webContents.send('claude:stderr', { turnId: a.turnId, text: line })
      }
    }
  })
  proc.stderr?.on('data', (d) => win.webContents.send('claude:stderr', { turnId: a.turnId, text: String(d) }))
  proc.on('error', (e) => win.webContents.send('claude:stderr', { turnId: a.turnId, text: e.message }))
  proc.on('exit', (code) => {
    turns.delete(a.turnId)
    win.webContents.send('claude:done', { turnId: a.turnId, code: code ?? -1 })
  })

  return { ok: true }
}

/** Kill the process tree for a turn (best-effort; exit fires claude:done). */
export function cancelTurn(turnId: string): void {
  const proc = turns.get(turnId)
  if (!proc?.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
  else proc.kill('SIGTERM')
}

/** Kill every live turn (called on quit). */
export function cancelAllTurns(): void {
  for (const id of [...turns.keys()]) cancelTurn(id)
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (the file is included via `electron/**/*.ts`).

- [ ] **Step 3: Commit**

```bash
git add electron/claude.ts
git commit -F - <<'EOF'
feat(main): claude.ts — spawn CLI, parse stream-json, IPC events
EOF
```

---

## Task 8: Register `claude` IPC + preload surface

**Files:**
- Modify: `electron/main.ts` (imports `:1-6`; `registerIpc` body ends `:310`; quit hooks `:330-335`)
- Modify: `electron/preload.ts` (add `claude` to `api`, after the `miku` block `:63`)

- [ ] **Step 1: Import the claude module in `main.ts`**

At the top of `electron/main.ts`, after the existing imports (around `:6`):
```ts
import { detectClaude, startTurn, cancelTurn, cancelAllTurns } from './claude'
```

- [ ] **Step 2: Register the IPC handlers**

Inside `registerIpc()` in `main.ts`, just before its closing `}` (line 310), add:
```ts
  // ── Real claude CLI backend (Slice A) ──────────────────────────────────────
  ipcMain.handle('claude:available', async () => (await detectClaude()) !== null)
  ipcMain.handle('claude:start', (_e, args) => {
    if (!mainWindow) return { ok: false, error: 'no window' }
    return startTurn(mainWindow, args)
  })
  ipcMain.handle('claude:cancel', (_e, turnId: string) => {
    cancelTurn(turnId)
    return { ok: true }
  })
```

- [ ] **Step 3: Kill turns on quit**

In `main.ts`, update the two quit hooks (`:330`, `:332-335`):
```ts
app.on('before-quit', () => {
  cancelAllTurns()
  stopMiku()
})

app.on('window-all-closed', () => {
  cancelAllTurns()
  stopMiku()
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 4: Add the preload `claude` surface**

In `electron/preload.ts`, inside the `api` object after the `miku` block (after line 63's closing `},`), add:
```ts
  /** Real claude CLI backend (Slice A). */
  claude: {
    available: (): Promise<boolean> => ipcRenderer.invoke('claude:available'),
    startTurn: (args: {
      turnId: string
      prompt: string
      cwd: string
      sessionId?: string
      model?: string
      permissionMode: 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default'
    }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('claude:start', args),
    cancelTurn: (turnId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('claude:cancel', turnId),
    onEvent: (cb: (msg: { turnId: string; event: unknown }) => void): (() => void) => {
      const l = (_e: unknown, msg: { turnId: string; event: unknown }): void => cb(msg)
      ipcRenderer.on('claude:event', l)
      return () => ipcRenderer.removeListener('claude:event', l)
    },
    onStderr: (cb: (msg: { turnId: string; text: string }) => void): (() => void) => {
      const l = (_e: unknown, msg: { turnId: string; text: string }): void => cb(msg)
      ipcRenderer.on('claude:stderr', l)
      return () => ipcRenderer.removeListener('claude:stderr', l)
    },
    onDone: (cb: (msg: { turnId: string; code: number }) => void): (() => void) => {
      const l = (_e: unknown, msg: { turnId: string; code: number }): void => cb(msg)
      ipcRenderer.on('claude:done', l)
      return () => ipcRenderer.removeListener('claude:done', l)
    },
  },
```

(`ClaudeDeckApi = typeof api` at `:68` picks this up automatically; `env.d.ts` already re-exports it.)

- [ ] **Step 5: Typecheck + build**

```bash
npm run typecheck
npm run build
```
Expected: both clean/succeed.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -F - <<'EOF'
feat(ipc): expose claude:available/start/cancel + event bridge
EOF
```

---

## Task 9: `claudeClient.ts` renderer wrapper

**Files:**
- Create: `src/renderer/cli/claudeClient.ts`

- [ ] **Step 1: Write the client**

Create `src/renderer/cli/claudeClient.ts`:

```ts
import type {
  ClaudeEvent, ClaudeEventMsg, ClaudeStderrMsg, ClaudeDoneMsg, StartTurnRequest,
} from './types'

function bridge() {
  return typeof window !== 'undefined' ? window.claudedeck?.claude : undefined
}

export function isClaudeManaged(): boolean {
  return !!bridge()
}

export async function claudeAvailable(): Promise<boolean> {
  return (await bridge()?.available()) ?? false
}

export async function startTurn(req: StartTurnRequest): Promise<{ ok: boolean; error?: string }> {
  return (await bridge()?.startTurn(req)) ?? { ok: false, error: 'claude bridge unavailable' }
}

export function cancelTurn(turnId: string): void {
  void bridge()?.cancelTurn(turnId)
}

export interface TurnHandlers {
  onEvent: (event: ClaudeEvent) => void
  onStderr: (text: string) => void
  onDone: (code: number) => void
}

/** Subscribe to one turn's events; returns an unsubscribe fn. */
export function subscribe(turnId: string, h: TurnHandlers): () => void {
  const b = bridge()
  if (!b) return () => {}
  const offE = b.onEvent((m: ClaudeEventMsg) => { if (m.turnId === turnId) h.onEvent(m.event as ClaudeEvent) })
  const offS = b.onStderr((m: ClaudeStderrMsg) => { if (m.turnId === turnId) h.onStderr(m.text) })
  const offD = b.onDone((m: ClaudeDoneMsg) => { if (m.turnId === turnId) h.onDone(m.code) })
  return () => { offE(); offS(); offD() }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`window.claudedeck.claude.onEvent` is typed `(msg: { turnId; event: unknown }) => void` in preload; the cast `m.event as ClaudeEvent` bridges to the renderer union.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/cli/claudeClient.ts
git commit -F - <<'EOF'
feat(cli): claudeClient — renderer wrapper over the IPC bridge
EOF
```

---

## Task 10: Composer `onSend` + imperative `submit()` + lift `modelId`

Wire the dead `// mock send — no-op` to a real callback and expose a programmatic submit the `"ส่ง"` voice command (Task 13) can call.

**Files:**
- Modify: `src/renderer/views/chat/Composer.tsx` (`:1`, `:9-12`, `:19-22`, `:37-42`, `:95-106`)
- Modify: `src/renderer/views/chat/ChatView.tsx` (`:6`, `:8`, `:39`)

- [ ] **Step 1: Convert `Composer` to forwardRef with an imperative `submit()`**

Replace `src/renderer/views/chat/Composer.tsx` lines 1-42 with:

```tsx
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ArrowUp, Slash, Mic } from 'lucide-react'
import { ModelPicker } from '@/components/ModelPicker'
import { useSettings } from '@/settings/SettingsContext'
import { useDictation } from '@/settings/speechRecognition'
import { resolveLang } from '@/settings/speech'
import { MODELS } from '@/mock/fixtures'

export interface ComposerHandle {
  /** Submit the current text programmatically (used by the "ส่ง" voice command). */
  submit: () => void
}

interface ComposerProps {
  /** Session model label, used to seed the initial selection. */
  model: string
  /** Called with the message text + selected model id when the user sends. */
  onSend: (text: string, modelId: string) => void
}

function seedModelId(label: string): string {
  const hit = MODELS.find((m) => m.label.toLowerCase().includes(label.toLowerCase()))
  return hit?.id ?? 'opus-4-8'
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { model, onSend },
  ref,
): JSX.Element {
  const { settings } = useSettings()
  const [value, setValue] = useState('')
  const [modelId, setModelId] = useState(() => seedModelId(model))
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const resize = (): void => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const dictation = useDictation((text) => {
    setValue((v) => (v ? `${v} ${text}` : text))
    requestAnimationFrame(resize)
  }, resolveLang(settings.voiceLang).code)

  const submit = (): void => {
    const text = value.trim()
    if (!text) return
    onSend(text, modelId)
    setValue('')
    requestAnimationFrame(resize)
  }

  useImperativeHandle(ref, () => ({ submit }))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }
```

- [ ] **Step 2: Wire the send button + close the forwardRef**

In the same file, change the send `<button>` (originally `:95-106`) to call `submit`:
```tsx
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                title="Send message"
                aria-label="Send message"
```
(keep the existing className/icon.)

Then at the very end of the file, the function body is now inside `forwardRef`, so the final line must be `})` instead of the old `}`. Ensure the file ends:
```tsx
  )
})
```
(Remove the old standalone `}` that closed `function Composer`.)

- [ ] **Step 3: Pass `onSend` + a ref through `ChatView`**

Replace `src/renderer/views/chat/ChatView.tsx`:

Line 6 import:
```tsx
import { Composer, type ComposerHandle } from './Composer'
```
Line 8 signature:
```tsx
export default function ChatView({
  session,
  onSend,
  composerRef,
}: {
  session: Session
  onSend: (text: string, modelId: string) => void
  composerRef?: React.Ref<ComposerHandle>
}): JSX.Element {
```
Line 39 composer:
```tsx
      <Composer ref={composerRef} model={session.model} onSend={onSend} />
```

- [ ] **Step 4: Give App a temporary mock `onSend` so it compiles**

In `src/renderer/App.tsx`, where `centerView` renders `<ChatView session={activeSession} />` (`:281`), change to:
```tsx
        return <ChatView session={activeSession} onSend={handleSend} composerRef={composerRef} />
```
and add, near the other hooks (after the `useSessions` line from Task 4):
```ts
  const composerRef = useRef<ComposerHandle>(null)
```
Add the import at the top of App.tsx:
```ts
import type { ComposerHandle } from '@/views/chat/Composer'
```
Add a temporary `handleSend` (replaced fully in Task 12) just above `centerView`:
```ts
  const handleSend = (text: string, modelId: string): void => {
    // Temporary mock echo — replaced by the live/mock turn dispatcher in Task 12.
    void text; void modelId
  }
```

- [ ] **Step 5: Typecheck + build**

```bash
npm run typecheck
npm run build
```
Expected: clean/succeed.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/views/chat/Composer.tsx src/renderer/views/chat/ChatView.tsx src/renderer/App.tsx
git commit -F - <<'EOF'
feat(chat): Composer onSend + imperative submit() + lift modelId
EOF
```

---

## Task 11: Thread live terminal lines into the panel

**Files:**
- Modify: `src/renderer/views/terminal/TerminalOutput.tsx` (`:1-32`)
- Modify: `src/renderer/layout/BottomPanel.tsx` (`:2`, `:4-8`, `:29`)
- Modify: `src/renderer/App.tsx` (BottomPanel render `:349`)

- [ ] **Step 1: Make `TerminalOutput` accept `lines` (fallback to fixture)**

Replace `src/renderer/views/terminal/TerminalOutput.tsx` lines 1-32 with:

```tsx
import { useEffect, useRef } from 'react'
import { TERMINAL_LINES, type TerminalLine } from '@/mock/fixtures'

interface TerminalOutputProps {
  /** Live lines for the active session; falls back to the mock when omitted/empty. */
  lines?: TerminalLine[]
}

export default function TerminalOutput({ lines }: TerminalOutputProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const data = lines && lines.length > 0 ? lines : TERMINAL_LINES

  // Auto-scroll to bottom on mount and when content changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [data.length])

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-3 font-mono text-xs text-fg-muted">
        No output yet
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto bg-bg p-3 font-mono text-xs leading-relaxed">
      {data.map((line) => (
        <div key={line.id} className={getLineClass(line.kind)}>
          {line.kind === 'command' && <span className="mr-1 text-accent">$</span>}
          {line.text}
        </div>
      ))}
      <CaretBlinker />
    </div>
  )
}
```
(Leave `getLineClass` and `CaretBlinker` unchanged below.)

- [ ] **Step 2: Thread `lines` through `BottomPanel`**

In `src/renderer/layout/BottomPanel.tsx`:

Line 2 import:
```tsx
import TerminalOutput from '@/views/terminal/TerminalOutput'
import type { TerminalLine } from '@/mock/fixtures'
```
Props (`:4-8`):
```tsx
interface BottomPanelProps {
  onClose: () => void
  lines?: TerminalLine[]
}

export function BottomPanel({ onClose, lines }: BottomPanelProps): JSX.Element {
```
Render (`:29`):
```tsx
        <TerminalOutput lines={lines} />
```

- [ ] **Step 3: Pass the active session's lines from App**

In `src/renderer/App.tsx`, the BottomPanel render (`:349`):
```tsx
                    <BottomPanel onClose={() => setBottomOpen(false)} lines={activeSession.terminalLines} />
```

- [ ] **Step 4: Typecheck + build**

```bash
npm run typecheck
npm run build
```
Expected: clean/succeed (mock terminal still shows because seeded `s1.terminalLines === TERMINAL_LINES`; live lines replace it once a turn runs).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/views/terminal/TerminalOutput.tsx src/renderer/layout/BottomPanel.tsx src/renderer/App.tsx
git commit -F - <<'EOF'
feat(terminal): render live per-session terminal lines via props
EOF
```

---

## Task 12: Wire the live turn + Live/Mock toggle + permission dropdown

Replace the temporary `handleSend` with the real mock+live dispatcher, add the connection state, and add the toggle/dropdown to the StatusBar (keyboard + aria reachable; voice in Task 13).

**Files:**
- Modify: `src/renderer/layout/StatusBar.tsx`
- Modify: `src/renderer/App.tsx` (imports; new state; `handleSend`; effects; StatusBar render `:367`)

- [ ] **Step 1: Add controls to `StatusBar`**

Replace `src/renderer/layout/StatusBar.tsx` with:

```tsx
import { GitBranch, Cpu, Coins, FolderOpen, Dot } from 'lucide-react'
import type { Session } from '@/mock/fixtures'
import type { PermissionMode } from '@/cli/types'

interface StatusBarProps {
  session: Session
  live: boolean
  claudeAvailable: boolean
  permissionMode: PermissionMode
  onToggleLive: () => void
  onChangePermission: (mode: PermissionMode) => void
}

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  plan: 'Plan (read-only)',
  acceptEdits: 'Accept edits',
  bypassPermissions: 'Bypass',
  default: 'Default',
}

export function StatusBar({
  session, live, claudeAvailable, permissionMode, onToggleLive, onChangePermission,
}: StatusBarProps): JSX.Element {
  const connected = session.status !== 'error'
  return (
    <footer
      className="flex shrink-0 items-center justify-between border-t border-border bg-surface px-3 text-xs text-fg-muted"
      style={{ height: 'var(--statusbar-h)' }}
    >
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <Dot size={18} className={connected ? 'text-success' : 'text-destructive'} strokeWidth={6} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <span className="flex items-center gap-1.5">
          <GitBranch size={12} />
          {session.cwd.split('/').pop()}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Live / Mock toggle */}
        <button
          type="button"
          onClick={onToggleLive}
          disabled={!claudeAvailable}
          aria-pressed={live}
          aria-label={live ? 'Live mode — using the real claude CLI. Click to switch to mock.' : 'Mock mode. Click to go live with the real claude CLI.'}
          title={claudeAvailable ? (live ? 'Live (real claude CLI)' : 'Mock data') : 'claude CLI not detected'}
          className={`rounded px-2 py-0.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            live ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-fg-muted hover:text-fg'
          } ${claudeAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
        >
          {live ? '● Live' : '○ Mock'}
        </button>

        {/* Permission mode */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Permission mode</span>
          <select
            value={permissionMode}
            onChange={(e) => onChangePermission(e.target.value as PermissionMode)}
            aria-label="claude permission mode"
            className="rounded border border-border bg-bg px-1.5 py-0.5 text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((m) => (
              <option key={m} value={m}>{PERMISSION_LABELS[m]}</option>
            ))}
          </select>
        </label>

        <span className="flex items-center gap-1.5">
          <FolderOpen size={12} />
          {session.cwd}
        </span>
        <span className="flex items-center gap-1.5">
          <Cpu size={12} />
          {session.model}
        </span>
        <span className="flex items-center gap-1.5 font-mono">
          <Coins size={12} />
          {session.tokens.toLocaleString()} tok
        </span>
      </div>
    </footer>
  )
}
```

> Tailwind note: `sr-only` is a stock Tailwind utility (visually-hidden, screen-reader-only). It is available in the default v3.4 build used here.

- [ ] **Step 2: Add connection state + ID helper in App**

In `src/renderer/App.tsx`, add imports near the others:
```ts
import * as claudeClient from '@/cli/claudeClient'
import type { PermissionMode, ClaudeEvent } from '@/cli/types'
import type { TerminalLine } from '@/mock/fixtures'
```
Add state (after the `composerRef` line):
```ts
  const [liveMode, setLiveMode] = useState(false)
  const [claudeOk, setClaudeOk] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('plan')

  // Probe for the claude CLI once.
  useEffect(() => {
    void claudeClient.claudeAvailable().then(setClaudeOk)
  }, [])

  // Monotonic id source (reducer stays pure — ids come from here).
  const idRef = useRef(0)
  const nextId = (p: string): string => `${p}-${Date.now()}-${idRef.current++}`
```

- [ ] **Step 3: Replace the temporary `handleSend` with the real dispatcher**

In `src/renderer/App.tsx`, replace the placeholder `handleSend` from Task 10 with:

```ts
  const speakStatus = (text: string): void => {
    if (!text) return
    void speakSmart(text, {
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      voiceURI: settings.voiceURI,
      lang: voiceCode,
    })
  }

  const handleSend = (text: string, modelId: string): void => {
    const sid = activeSession.id
    const now = new Date().toISOString()
    const userMessage = {
      id: nextId('u'), role: 'user' as const, createdAt: now,
      parts: [{ kind: 'markdown' as const, text }],
    }

    const useLive = liveMode && claudeOk
    const assistantMessage = {
      id: nextId('a'), role: 'assistant' as const, createdAt: now,
      parts: useLive ? [] : [{ kind: 'markdown' as const, text: th ? '(โหมดจำลอง — ยังไม่ได้เชื่อมต่อ)' : '(mock mode — not connected)' }],
      streaming: useLive,
    }
    sessionsDispatch({ type: 'startTurn', sessionId: sid, userMessage, assistantMessage })

    if (!useLive) {
      sessionsDispatch({ type: 'finishTurn', sessionId: sid })
      return
    }

    speakStatus(th ? 'กำลังคิด' : 'Thinking')

    const turnId = nextId('turn')
    const off = claudeClient.subscribe(turnId, {
      onEvent: (event: ClaudeEvent) => {
        sessionsDispatch({ type: 'event', sessionId: sid, event })
        announceEvent(event)
        sessionsDispatch({
          type: 'terminal', sessionId: sid,
          line: { id: nextId('tl'), kind: 'stdout', text: terminalSummary(event) },
        })
      },
      onStderr: (textLine: string) => {
        sessionsDispatch({
          type: 'terminal', sessionId: sid,
          line: { id: nextId('tl'), kind: 'stderr', text: textLine },
        })
      },
      onDone: () => {
        sessionsDispatch({ type: 'finishTurn', sessionId: sid })
        off()
      },
    })

    void claudeClient
      .startTurn({
        turnId, prompt: text, cwd: activeSession.cwd,
        sessionId: activeSession.claudeSessionId, model: modelId, permissionMode,
      })
      .then((r) => {
        if (!r.ok) {
          sessionsDispatch({
            type: 'terminal', sessionId: sid,
            line: { id: nextId('tl'), kind: 'stderr', text: r.error ?? 'failed to start claude' },
          })
          sessionsDispatch({ type: 'finishTurn', sessionId: sid })
          speakStatus(th ? 'เกิดข้อผิดพลาด' : 'Error')
          off()
        }
      })
  }
```

Add the two helpers (spoken-status + terminal summary) above `handleSend`:
```ts
  const announceEvent = (event: ClaudeEvent): void => {
    if (event.type === 'assistant') {
      const tool = event.message.content.find((c) => c.type === 'tool_use')
      if (tool && tool.type === 'tool_use') {
        speakStatus(th ? `กำลังใช้ ${tool.name}` : `Running ${tool.name}`)
      }
    } else if (event.type === 'result') {
      speakStatus(event.is_error ? (th ? 'เกิดข้อผิดพลาด' : 'Error') : (th ? 'เสร็จแล้ว' : 'Done'))
    }
  }

  const terminalSummary = (event: ClaudeEvent): string => {
    switch (event.type) {
      case 'system': return `● init ${event.session_id ?? ''}`.trim()
      case 'assistant':
        return event.message.content
          .map((c) => (c.type === 'tool_use' ? `● ${c.name}` : c.type === 'text' ? '● (text)' : `● ${c.type}`))
          .join('  ')
      case 'user': return '  ⎿ tool result'
      case 'result': return event.is_error ? '✗ result: error' : '✓ result: done'
      default: return ''
    }
  }
```

- [ ] **Step 4: Pass the new props to StatusBar**

In `src/renderer/App.tsx`, replace the StatusBar render (`:367`):
```tsx
      <StatusBar
        session={activeSession}
        live={liveMode}
        claudeAvailable={claudeOk}
        permissionMode={permissionMode}
        onToggleLive={() => setLiveMode((v) => !v)}
        onChangePermission={setPermissionMode}
      />
```

- [ ] **Step 5: Typecheck + build**

```bash
npm run typecheck
npm run build
```
Expected: clean/succeed.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/layout/StatusBar.tsx
git commit -F - <<'EOF'
feat(cli): live turn dispatcher + Live/Mock toggle + permission mode
EOF
```

---

## Task 13: Accessibility — natural-sentence commands, send-by-voice, spoken status, read-live

Make every Slice-A capability reachable by voice. `speakStatus` (Task 12) already routes status through `speakSmart` (inherits the user's engine + rate/pitch/voiceURI/lang). This task (a) hardens command matching so blind users can speak **natural full sentences** ("ช่วยอ่านให้ฟังหน่อย", "ช่วยส่งข้อความให้ที") not just keywords, (b) adds the new commands + an aria-live region, and (c) confirms `"อ่าน"` reads the live reply.

**Why the matcher change:** today `dispatchCommand` (`voiceCommands.ts:27`) matches on `t.includes(phrase)` and returns the **first** command whose any phrase is a substring. Substring matching already finds a keyword embedded in a sentence — but in Thai (no inter-word spaces) a *short* phrase can hijack a longer sentence (e.g. the tasks phrase `"งาน"` is a substring of the resume sentence `"เริ่มทำงานต่อ"`). Switching to **longest-matching-phrase wins** makes the most specific command win regardless of declaration order, which is exactly what natural-sentence input needs.

**Files:**
- Modify: `src/renderer/settings/voiceCommands.ts` (`dispatchCommand` `:21-33`)
- Create: `src/renderer/settings/voiceCommands.test.ts`
- Modify: `src/renderer/App.tsx` (commands `:99-114`; add aria-live element near `:286`)

- [ ] **Step 1: Write failing tests for natural-sentence + longest-match dispatch**

Create `src/renderer/settings/voiceCommands.test.ts`. (`speak()` early-returns when there is no `window` — vitest runs in the `node` env — so calling `dispatchCommand` is safe here.)

```ts
import { describe, it, expect, vi } from 'vitest'
import { dispatchCommand, type VoiceCommand } from './voiceCommands'

function cmds() {
  const read = vi.fn()
  const tasks = vi.fn()
  const resume = vi.fn()
  const send = vi.fn()
  const commands: VoiceCommand[] = [
    { phrases: ['tasks', 'งาน', 'บอร์ด'], run: tasks, confirm: '', label: 'tasks' },
    { phrases: ['resume', 'เริ่มทำงานต่อ', 'ทำงานต่อ'], run: resume, confirm: '', label: 'resume' },
    { phrases: ['read response', 'อ่าน', 'อ่านให้ฟัง'], run: read, confirm: '', label: 'read' },
    { phrases: ['send', 'ส่ง', 'ส่งข้อความ'], run: send, confirm: '', label: 'send' },
  ]
  return { commands, read, tasks, resume, send }
}

describe('dispatchCommand (natural sentences)', () => {
  it('matches a command embedded in a full sentence', () => {
    const { commands, read } = cmds()
    dispatchCommand(commands, 'ช่วยอ่านให้ฟังหน่อย', 'th-TH')
    expect(read).toHaveBeenCalledOnce()
  })

  it('the longest matching phrase wins (resume beats tasks in "เริ่มทำงานต่อ")', () => {
    const { commands, resume, tasks } = cmds()
    dispatchCommand(commands, 'เริ่มทำงานต่อ', 'th-TH')
    expect(resume).toHaveBeenCalledOnce()
    expect(tasks).not.toHaveBeenCalled()
  })

  it('prefers the more specific send phrase in a sentence', () => {
    const { commands, send } = cmds()
    const hit = dispatchCommand(commands, 'ช่วยส่งข้อความให้ที', 'th-TH')
    expect(send).toHaveBeenCalledOnce()
    expect(hit?.label).toBe('send')
  })

  it('returns null when nothing matches', () => {
    const { commands } = cmds()
    expect(dispatchCommand(commands, 'สวัสดีครับ', 'th-TH')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/settings/voiceCommands.test.ts`
Expected: the longest-match test FAILS (current first-wins logic; with these `commands` ordered tasks-first, `"เริ่มทำงานต่อ"` matches `tasks` via `"งาน"`).

- [ ] **Step 3: Rewrite `dispatchCommand` to longest-match**

In `src/renderer/settings/voiceCommands.ts`, replace the `dispatchCommand` function (`:20-33`) with:

```ts
/**
 * Match a transcript to a command and run it. Blind users speak natural
 * sentences ("ช่วยอ่านให้ฟังหน่อย"), so we substring-match each phrase against
 * the whole transcript and let the LONGEST (most specific) matching phrase win —
 * this stops a short Thai keyword (e.g. "งาน") from hijacking a longer sentence
 * (e.g. "เริ่มทำงานต่อ"). Ties keep declaration order (first wins).
 */
export function dispatchCommand(
  commands: VoiceCommand[],
  raw: string,
  lang = 'en-US',
): VoiceCommand | null {
  const t = raw.toLowerCase().trim()
  let best: VoiceCommand | null = null
  let bestLen = 0
  for (const c of commands) {
    for (const p of c.phrases) {
      const lp = p.toLowerCase()
      if (lp && t.includes(lp) && lp.length > bestLen) {
        best = c
        bestLen = lp.length
      }
    }
  }
  if (best) {
    best.run()
    if (best.confirm) speak(best.confirm, { rate: 1.05, lang })
  }
  return best
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/settings/voiceCommands.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the `"ส่ง"` / send command (with natural variants)**

In `src/renderer/App.tsx`, in the `commands` array (after the `read` command at `:112`), add. Phrases stay short keywords (`ส่ง`, `send`) since longest-match now resolves them inside sentences like "ช่วยส่งข้อความให้ที", with the more specific `ส่งข้อความ` winning when present:
```ts
    { phrases: ['send', 'send message', 'submit', 'ส่ง', 'ส่งข้อความ', 'ส่งเลย', 'ส่งให้หน่อย'], run: () => composerRef.current?.submit(), confirm: th ? 'ส่งแล้ว' : 'Sent', label: '“send” / “ส่ง”' },
```

- [ ] **Step 6: Add Live/Mock + permission voice commands**

In the same `commands` array, add:
```ts
    { phrases: ['live mode', 'go live', 'connect', 'โหมดสด', 'เชื่อมต่อ', 'ใช้งานจริง'], run: () => { if (claudeOk) setLiveMode(true) }, confirm: th ? 'โหมดสด' : 'Live mode', label: '“live” / “โหมดสด”' },
    { phrases: ['mock mode', 'offline mode', 'โหมดจำลอง', 'โหมดทดสอบ'], run: () => setLiveMode(false), confirm: th ? 'โหมดจำลอง' : 'Mock mode', label: '“mock” / “โหมดจำลอง”' },
    { phrases: ['plan mode', 'read only', 'โหมดวางแผน', 'อ่านอย่างเดียว'], run: () => setPermissionMode('plan'), confirm: th ? 'โหมดวางแผน' : 'Plan mode', label: '“plan mode” / “โหมดวางแผน”' },
    { phrases: ['accept edits', 'allow edits', 'ยอมรับการแก้ไข', 'อนุญาตแก้ไข'], run: () => setPermissionMode('acceptEdits'), confirm: th ? 'ยอมรับการแก้ไข' : 'Accept edits', label: '“accept edits” / “ยอมรับการแก้ไข”' },
```

> These call `setLiveMode`/`setPermissionMode` from Task 12. Because `commands` is rebuilt each render, the closures always see current state — no stale-closure issue.

- [ ] **Step 7: Confirm `"อ่าน"` reads the live reply**

No code change needed: `readLastResponse` (`:80-94`) reads `activeSession.messages`, and `activeSession` now comes from `useSessions` (Task 4), so it already reads the live streamed reply. Verify by reading the code that the last `assistant` message's `markdown`/`thinking` parts are spoken (the existing `.parts.map((p) => ('text' in p ? p.text : ''))` handles both `markdown` and `thinking` parts, skipping `tool`/`code`). Leave as-is.

- [ ] **Step 4: Add a visually-hidden aria-live status region**

In `src/renderer/App.tsx`, add a `liveStatus` state next to the others:
```ts
  const [liveStatus, setLiveStatus] = useState('')
```
Update `speakStatus` (Task 12) to also push to the region:
```ts
  const speakStatus = (text: string): void => {
    if (!text) return
    setLiveStatus(text)
    void speakSmart(text, {
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      voiceURI: settings.voiceURI,
      lang: voiceCode,
    })
  }
```
Add the region just inside the root `<div>` (after the opening tag at `:286`, before `<VoiceControlIndicator …>`):
```tsx
      <div className="sr-only" role="status" aria-live="polite">{liveStatus}</div>
```

- [ ] **Step 5: Typecheck + build**

```bash
npm run typecheck
npm run build
```
Expected: clean/succeed.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx
git commit -F - <<'EOF'
feat(a11y): voice send/live/mock/permission commands + aria-live status
EOF
```

---

## Task 14: Manual verification + handoff update

No new code; verify the slice end-to-end and record results. The pure logic is covered by `vitest`; the live path needs the real Electron app.

**Files:**
- Modify: `HANDOFF.md` (mark item 3 / Slice A status), memory note (optional)

- [ ] **Step 1: Full automated gate**

```bash
npx vitest run
npm run typecheck
npm run build
```
Expected: all tests PASS; typecheck clean; build succeeds. Record the test count.

- [ ] **Step 2: Manual — sighted smoke (real Electron)**

Run `npm run dev` (or `start-dev.bat`). With a `claude` CLI installed:
- StatusBar shows `○ Mock` enabled, permission `Plan (read-only)`.
- Click the toggle → `● Live`. (If `claude` not found, the toggle is disabled with the "not detected" title — that is the correct fallback.)
- Type a small prompt (e.g. "list two colors"), press Enter. Observe: assistant message grows (text → any tool card resolving), the terminal panel shows the event log + any stderr, and on completion the streaming caret stops. The next turn reuses `--resume` (a follow-up like "and a third" should keep context).
- Click `● Live` off → send → see the `(mock mode)` echo.

- [ ] **Step 3: Manual — blind UX (do NOT look at the screen)**

With voice control on (Ctrl+Shift+V), STT engine selected, and a TTS engine (system/edge/custom Miku) selected:
- Dictate a prompt (mic button or push-to-talk), then say the wake-word + **"ส่ง"**. Confirm the turn starts.
- Hear the spoken cues — "กำลังคิด" at start, "กำลังใช้ <tool>" on a tool, "เสร็จแล้ว"/"เกิดข้อผิดพลาด" at the end — **in the same voice the user selected** (status uses `speakSmart`).
- Say the wake-word + **"อ่าน"** → hear the real streamed reply read back.
- Say **"โหมดสด"/"โหมดจำลอง"** and **"โหมดวางแผน"/"ยอมรับการแก้ไข"** → confirm the toggle/dropdown change (audible confirmations) without using the mouse.
- Confirm existing nav commands ("แชท", "แท็บถัดไป", "เทอร์มินอล") still work against the live session.

Record PASS/FAIL per bullet. File any defect as its own follow-up; do not expand Slice A scope.

- [ ] **Step 4: Update `HANDOFF.md`**

Under TODO item 3, note Slice A done (real claude CLI → stream-json → chat + terminal; voice send/status/read wired) and that Slice B (todos/diffs) + Slice C (auto-read while streaming, voice cancel, partial-message deltas) remain.

- [ ] **Step 5: Commit + push**

```bash
git add HANDOFF.md
git commit -F - <<'EOF'
docs(handoff): P2 Slice A done — real claude CLI backend wired
EOF
git push origin main
```

---

## Self-Review

**Spec coverage:**
- §1/§4 spawn claude, parse stream-json, render to chat+terminal → Tasks 6–12. ✅
- §2 claude-first + adapter seam → `electron/claude.ts` is provider-specific behind a generic IPC/`claudeClient` seam; codex can add a sibling. ✅
- §3 permission-mode user-selectable, default plan → Task 12 dropdown + `permissionMode` state defaulting `'plan'`. ✅
- §3 (real work) static-import → React state → Tasks 2–4 (`useSessions`). ✅
- §3a.1 send by voice → Task 13 `"ส่ง"` → `composerRef.submit()` (dictate → ส่ง → live turn). ✅
- §3a.2 spoken status via `speakSmart` (same voice) → Task 12 `speakStatus` + Task 13 aria-live. ✅
- §3a.3 read the live reply → Task 13 Step 3 (`readLastResponse` reads live `activeSession`). ✅
- §3a.4 toggle/dropdown voice+keyboard reachable → Task 12 (aria-labels, focus rings) + Task 13 (voice). ✅
- §5 data flow, §6 safety (argv array, no shell, validate cwd, default plan, binary-not-found fallback) → Task 7. ✅
- §7 error handling (malformed JSON → stderr log; non-zero exit/error result → message error + terminal) → Tasks 7, 12. ✅
- §8 testing (mapper unit + reducer unit + manual sighted + manual blind) → Tasks 3, 6, 14. ✅
- §9 out-of-scope (Slice B/C, approval cards, codex impl, node-pty) → not implemented; recorded. ✅
- §10 open items: partial-message shape → resolved by dropping `--include-partial-messages` in Slice A (deviation recorded); toggle/dropdown location → StatusBar (Task 12). ✅

**Type consistency:** `Session.terminalLines`/`claudeSessionId` (Task 2) used in Tasks 3,11,12. `SessionsAction` variants `startTurn|event|terminal|finishTurn` consistent across Tasks 3,4,12. `foldEvent`/`emptyAssistantMessage`/`FoldResult` consistent Tasks 3,6. `ClaudeEvent`/`ContentBlock`/`ToolResultContent`/`PermissionMode`/`StartTurnRequest` defined in Task 5, used in 6,7,9,12,13. `ComposerHandle.submit` defined Task 10, used Task 13. preload `claude.{available,startTurn,cancelTurn,onEvent,onStderr,onDone}` (Task 8) matches `claudeClient` (Task 9). IPC channels `claude:available|start|cancel|event|stderr|done` consistent Tasks 7,8.

**Placeholder scan:** the only intentional stub is Task 10 Step 4's temporary `handleSend`, explicitly replaced in Task 12 Step 3. No TBD/TODO/"handle edge cases" left.

**Ordering caveat (flagged in Task 3):** the reducer imports the mapper, so execute **1 → 2 → 5 → 6 → 3 → 4 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14**. The plan documents the reducer (Task 3) before the mapper (Tasks 5–6) for review clarity; at execution time, build the mapper first so Task 3's tests compile.
