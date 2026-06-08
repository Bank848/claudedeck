# ClaudeDeck — P2 Slice B: TodoPanel + DiffView from real CLI data — Implementation Plan

**Goal:** Drive the Todo panel and the Diff (Changes) view from **real per-session CLI data**
instead of the global mock fixtures. Todos come from the latest `TodoWrite` tool call; file
changes come from `Edit` / `Write` / `MultiEdit` tool calls — both derived purely from the
`ChatMessage[]` already folded by `streamMapper`. KanbanBoard stays on mock (P4 persistence
work, out of scope here).

**Architecture:** The fold pipeline already turns stream-json `tool_use` blocks into
`{ kind: 'tool', call: ToolCall }` parts on each assistant message — but `blockToPart` currently
**drops the raw `input`**, which is exactly where `TodoWrite.todos` and `Edit/Write` payloads
live. Slice B (1) preserves `input` on `ToolCall`, (2) adds a pure `deriveSessionState(messages)`
selector that reads those tool calls into `Todo[]` + `FileChange[]`, and (3) feeds `TodoPanel`
and `DiffView` from the derived data when in **Live** mode, falling back to the mock fixtures in
**Mock** mode so the design-first showcase is unchanged.

**Tech stack:** React 18 + TS, Vitest. No new deps. Pure functions + props threading only — no
new IPC, no main-process change (Slice A's `claude:*` pipe already delivers the events).

**Key decisions / tradeoffs:**
- **Preserve `input` on `ToolCall`** (`input?: unknown`) rather than re-deriving todos/diffs
  inside the reducer. Keeps `streamMapper` dumb and the derivation pure + independently testable.
- **`live` prop chooses the source**, not "fall back to mock when empty". A genuinely-empty live
  session must show the empty state, not stale mock todos. `live ? derived : MOCK`.
- **Naive block diff** for `Edit` (emit the old lines as `remove`, the new lines as `add`, under
  one hunk header) — not an LCS/Myers diff. Good enough to visualize a change in Slice B; a real
  unified diff is a later polish.
- **Selector keyed off the folded `parts`**, so it works identically for replayed/resumed
  sessions and needs no extra state.

**Gate (before commit):** `npm run typecheck` && `npm run test` && `npm run build` all green.

---

## Spawned review — what it changed

- **Tightened the Task 4 `TODOS` replacement instruction.** The draft said "replace the three
  remaining `TODOS` references"; with `completed`/`total` redefined from the `todos` local, only
  the `{TODOS.map(...)}` list (line 46) actually changes — the `total === 0` guard already reads
  the new local. The `TODOS` import is kept (still used in Mock mode).
- **Confirmed no critical issues:** all types (`ToolCall`, `Todo`, `FileChange`, `DiffLine` with
  `'hunk'` + optional line numbers), exports (`emptyAssistantMessage`, `TODOS`, `FILE_CHANGES`),
  `ToolUseBlock.input`, the `<DiffView/>` (L421) + `<RightPanel/>` (L522) call sites, the `@/`
  vitest alias, and `tsc` strictness (`strict: true`, no `noUncheckedIndexedAccess`) all match the
  plan's code. `TODO_STATUSES.includes(...)` and the MultiEdit map/filter chain compile clean.

---

## File Structure

```
src/renderer/
  mock/fixtures.ts                     (MODIFY: add input?: unknown to ToolCall)
  cli/streamMapper.ts                  (MODIFY: preserve input in blockToPart)
  cli/streamMapper.test.ts             (MODIFY: assert input is kept)
  cli/deriveSessionState.ts            (NEW: deriveTodos + deriveChanges + deriveSessionState)
  cli/deriveSessionState.test.ts       (NEW: TDD — the meat)
  views/tasks/TodoPanel.tsx            (MODIFY: live prop → derived todos)
  layout/RightPanel.tsx                (MODIFY: thread live prop to TodoPanel)
  views/diffs/DiffView.tsx             (MODIFY: session + live props → derived changes)
  App.tsx                              (MODIFY: pass session+live to DiffView, live to RightPanel)
```

---

## Task 1 — Preserve tool `input` on `ToolCall`

**Files:** `src/renderer/mock/fixtures.ts`

The derivation needs the raw tool input. Add it as an optional field so existing mock data and
view code stay valid.

- [ ] In `fixtures.ts`, add `input` to the `ToolCall` interface (after `durationMs`):

```ts
export interface ToolCall {
  id: string
  /** Tool name, e.g. "Read", "Edit", "Bash", "Grep". */
  tool: string
  /** Short human label, e.g. "src/app.ts" or "npm test". */
  label: string
  status: ToolStatus
  /** Optional preview body (command output, file snippet). Monospace. */
  output?: string
  /** Optional duration label, e.g. "1.2s". */
  durationMs?: number
  /** Raw tool input from the stream-json tool_use block (used to derive todos/diffs). */
  input?: unknown
}
```

---

## Task 2 — Keep `input` when folding `tool_use` blocks

**Files:** `src/renderer/cli/streamMapper.ts`, `src/renderer/cli/streamMapper.test.ts`

Depends on Task 1 (the `ToolCall.input` field). Write the test first.

- [ ] In `streamMapper.test.ts`, add an assertion that a folded tool call keeps its input. Append
  inside the existing `describe('foldEvent', ...)` block (matching the file's existing style):

```ts
  it('preserves the raw tool_use input on the tool call', () => {
    const msg = emptyAssistantMessage('a1', '2026-06-08T00:00:00Z')
    const event: ClaudeEvent = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'a.ts', content: 'x' } },
        ],
      },
    }
    const { message } = foldEvent(msg, event)
    const part = message.parts[0]
    expect(part.kind).toBe('tool')
    if (part.kind === 'tool') {
      expect(part.call.input).toEqual({ file_path: 'a.ts', content: 'x' })
    }
  })
```

  (If `emptyAssistantMessage` / `ClaudeEvent` are not yet imported in the test file, add them to
  the existing imports from `./streamMapper` and `./types`.)

- [ ] In `streamMapper.ts`, carry `input` through `blockToPart`:

```ts
    case 'tool_use':
      return {
        kind: 'tool',
        call: {
          id: block.id,
          tool: block.name,
          label: toolLabel(block.name, block.input),
          status: 'running',
          input: block.input,
        },
      }
```

- [ ] Run `npm run test` → streamMapper tests green.

---

## Task 3 — `cli/deriveSessionState.ts` selector + tests (TDD, the meat)

**Files:** `src/renderer/cli/deriveSessionState.ts` (NEW), `src/renderer/cli/deriveSessionState.test.ts` (NEW)

Depends on Task 1 (types). Independent of Task 2 (no shared files — they can run in parallel).
Pure functions over `ChatMessage[]`. Write the test first (RED), then the module (GREEN).

- [ ] Create `src/renderer/cli/deriveSessionState.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { ChatMessage, ToolCall } from '@/mock/fixtures'
import { deriveTodos, deriveChanges, deriveSessionState } from './deriveSessionState'

function toolMsg(calls: Partial<ToolCall>[]): ChatMessage {
  return {
    id: 'm', role: 'assistant', createdAt: '2026-06-08T00:00:00Z',
    parts: calls.map((c, i) => ({
      kind: 'tool' as const,
      call: { id: `t${i}`, tool: c.tool ?? 'Read', label: c.label ?? 'x', status: 'done' as const, ...c },
    })),
  }
}

describe('deriveTodos', () => {
  it('returns [] when there is no TodoWrite call', () => {
    expect(deriveTodos([toolMsg([{ tool: 'Read' }])])).toEqual([])
  })

  it('maps the latest TodoWrite todos (content→title, keeps status + activeForm)', () => {
    const messages = [
      toolMsg([{ tool: 'TodoWrite', input: { todos: [{ content: 'old', status: 'completed', activeForm: 'Doing old' }] } }]),
      toolMsg([{ tool: 'TodoWrite', input: { todos: [
        { content: 'Write tests', status: 'completed', activeForm: 'Writing tests' },
        { content: 'Implement', status: 'in_progress', activeForm: 'Implementing' },
        { content: 'Refactor', status: 'pending', activeForm: 'Refactoring' },
      ] } }]),
    ]
    const todos = deriveTodos(messages)
    expect(todos.map((t) => t.title)).toEqual(['Write tests', 'Implement', 'Refactor'])
    expect(todos.map((t) => t.status)).toEqual(['completed', 'in_progress', 'pending'])
    expect(todos[1].activeForm).toBe('Implementing')
    expect(new Set(todos.map((t) => t.id)).size).toBe(3) // unique ids
  })

  it('ignores a malformed TodoWrite input without throwing', () => {
    expect(deriveTodos([toolMsg([{ tool: 'TodoWrite', input: { nope: 1 } }])])).toEqual([])
    expect(deriveTodos([toolMsg([{ tool: 'TodoWrite', input: undefined }])])).toEqual([])
  })
})

describe('deriveChanges', () => {
  it('returns [] when there are no Edit/Write calls', () => {
    expect(deriveChanges([toolMsg([{ tool: 'Read' }, { tool: 'Bash' }])])).toEqual([])
  })

  it('maps a Write call to an added file with all content as add lines', () => {
    const changes = deriveChanges([toolMsg([
      { tool: 'Write', input: { file_path: 'src/a.ts', content: 'line1\nline2' } },
    ])])
    expect(changes).toHaveLength(1)
    expect(changes[0].path).toBe('src/a.ts')
    expect(changes[0].status).toBe('added')
    expect(changes[0].additions).toBe(2)
    expect(changes[0].deletions).toBe(0)
    expect(changes[0].lines.filter((l) => l.kind === 'add')).toHaveLength(2)
  })

  it('maps an Edit call to a modified file with remove+add lines under a hunk', () => {
    const changes = deriveChanges([toolMsg([
      { tool: 'Edit', input: { file_path: 'src/b.ts', old_string: 'a\nb', new_string: 'a\nc\nd' } },
    ])])
    expect(changes[0].status).toBe('modified')
    expect(changes[0].deletions).toBe(2)
    expect(changes[0].additions).toBe(3)
    expect(changes[0].lines.some((l) => l.kind === 'hunk')).toBe(true)
  })

  it('expands MultiEdit edits into multiple hunks on one file', () => {
    const changes = deriveChanges([toolMsg([
      { tool: 'MultiEdit', input: { file_path: 'src/c.ts', edits: [
        { old_string: 'x', new_string: 'y' },
        { old_string: 'p', new_string: 'q' },
      ] } },
    ])])
    expect(changes).toHaveLength(1)
    expect(changes[0].lines.filter((l) => l.kind === 'hunk')).toHaveLength(2)
  })

  it('merges multiple ops on the same file into one FileChange (Write then Edit → added)', () => {
    const changes = deriveChanges([toolMsg([
      { tool: 'Write', input: { file_path: 'src/d.ts', content: 'hi' } },
      { tool: 'Edit', input: { file_path: 'src/d.ts', old_string: 'hi', new_string: 'bye' } },
    ])])
    expect(changes).toHaveLength(1)
    expect(changes[0].status).toBe('added') // first op wins for status
  })

  it('gives every FileChange a unique id and skips malformed input', () => {
    const changes = deriveChanges([toolMsg([
      { tool: 'Write', input: { file_path: 'a' } },          // no content
      { tool: 'Edit', input: { nope: 1 } },                   // no file_path
      { tool: 'Write', input: { file_path: 'b', content: 'c' } },
    ])])
    expect(changes.map((c) => c.path)).toEqual(['a', 'b'])
    expect(new Set(changes.map((c) => c.id)).size).toBe(changes.length)
  })
})

describe('deriveSessionState', () => {
  it('returns both todos and changes from one pass', () => {
    const messages = [toolMsg([
      { tool: 'TodoWrite', input: { todos: [{ content: 'Do', status: 'pending', activeForm: 'Doing' }] } },
      { tool: 'Write', input: { file_path: 'a.ts', content: 'x' } },
    ])]
    const s = deriveSessionState(messages)
    expect(s.todos).toHaveLength(1)
    expect(s.changes).toHaveLength(1)
  })
})
```

- [ ] Create `src/renderer/cli/deriveSessionState.ts`:

```ts
import type { ChatMessage, Todo, FileChange, DiffLine, ToolCall } from '@/mock/fixtures'

/** Derived, read-only view of a session for the Todo + Diff panels. */
export interface DerivedSessionState {
  todos: Todo[]
  changes: FileChange[]
}

/** All tool calls across a message list, in order. */
function toolCalls(messages: ChatMessage[]): ToolCall[] {
  return messages.flatMap((m) => m.parts).flatMap((p) => (p.kind === 'tool' ? [p.call] : []))
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

const TODO_STATUSES = ['pending', 'in_progress', 'completed'] as const
type TodoStatus = (typeof TODO_STATUSES)[number]
function asTodoStatus(v: unknown): TodoStatus {
  return TODO_STATUSES.includes(v as TodoStatus) ? (v as TodoStatus) : 'pending'
}

/** Todos = the LAST TodoWrite call's `input.todos`, mapped to Todo[]. */
export function deriveTodos(messages: ChatMessage[]): Todo[] {
  const writes = toolCalls(messages).filter((c) => c.tool === 'TodoWrite')
  const last = writes[writes.length - 1]
  if (!last) return []
  const raw = asRecord(last.input).todos
  if (!Array.isArray(raw)) return []
  return raw.map((item, i): Todo => {
    const o = asRecord(item)
    return {
      id: `todo-${i}`,
      title: typeof o.content === 'string' ? o.content : '',
      status: asTodoStatus(o.status),
      activeForm: typeof o.activeForm === 'string' ? o.activeForm : undefined,
    }
  }).filter((t) => t.title.length > 0)
}

function splitLines(s: string): string[] {
  return s.length === 0 ? [] : s.split('\n')
}

interface Edit {
  oldString: string
  newString: string
}

/** Flatten Edit/Write/MultiEdit into (path, status-hint, edits) ops, in order. */
function fileOp(call: ToolCall): { path: string; added: boolean; edits: Edit[] } | null {
  const o = asRecord(call.input)
  const path = typeof o.file_path === 'string' ? o.file_path : ''
  if (!path) return null
  if (call.tool === 'Write') {
    if (typeof o.content !== 'string') return null
    return { path, added: true, edits: [{ oldString: '', newString: o.content }] }
  }
  if (call.tool === 'Edit') {
    if (typeof o.old_string !== 'string' || typeof o.new_string !== 'string') return null
    return { path, added: false, edits: [{ oldString: o.old_string, newString: o.new_string }] }
  }
  if (call.tool === 'MultiEdit') {
    if (!Array.isArray(o.edits)) return null
    const edits = o.edits
      .map((e) => asRecord(e))
      .filter((e) => typeof e.old_string === 'string' && typeof e.new_string === 'string')
      .map((e): Edit => ({ oldString: e.old_string as string, newString: e.new_string as string }))
    if (edits.length === 0) return null
    return { path, added: false, edits }
  }
  return null
}

/** Build diff lines for one edit: removes for old, adds for new, under a hunk header. */
function editLines(edit: Edit, hunkIndex: number): DiffLine[] {
  const removed = splitLines(edit.oldString)
  const added = splitLines(edit.newString)
  const lines: DiffLine[] = [{ kind: 'hunk', text: `@@ change ${hunkIndex + 1} @@` }]
  removed.forEach((text) => lines.push({ kind: 'remove', text }))
  added.forEach((text) => lines.push({ kind: 'add', text }))
  return lines
}

/** Changes = Edit/Write/MultiEdit calls accumulated per file_path, in first-seen order. */
export function deriveChanges(messages: ChatMessage[]): FileChange[] {
  const order: string[] = []
  const byPath = new Map<string, FileChange>()
  let hunk = 0

  for (const call of toolCalls(messages)) {
    const op = fileOp(call)
    if (!op) continue
    let fc = byPath.get(op.path)
    if (!fc) {
      fc = {
        id: `change-${order.length}`,
        path: op.path,
        status: op.added ? 'added' : 'modified',
        additions: 0,
        deletions: 0,
        lines: [],
      }
      byPath.set(op.path, fc)
      order.push(op.path)
    }
    for (const edit of op.edits) {
      const lines = editLines(edit, hunk++)
      fc.lines.push(...lines)
      fc.additions += lines.filter((l) => l.kind === 'add').length
      fc.deletions += lines.filter((l) => l.kind === 'remove').length
    }
  }
  return order.map((p) => byPath.get(p) as FileChange)
}

export function deriveSessionState(messages: ChatMessage[]): DerivedSessionState {
  return { todos: deriveTodos(messages), changes: deriveChanges(messages) }
}
```

- [ ] Run `npm run test` → all deriveSessionState tests green.

---

## Task 4 — Feed `TodoPanel` from derived todos (live) + thread `live` through `RightPanel`

**Files:** `src/renderer/views/tasks/TodoPanel.tsx`, `src/renderer/layout/RightPanel.tsx`

Depends on Task 3. In Live mode the panel shows derived todos (empty → "No todos"); in Mock mode
it keeps the showcase fixtures.

- [ ] In `TodoPanel.tsx`, add a `live` prop and source the list from the derivation:

```tsx
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import type { Session, Todo } from '@/mock/fixtures'
import { TODOS } from '@/mock/fixtures'
import { deriveTodos } from '@/cli/deriveSessionState'

interface TodoPanelProps {
  session: Session
  /** Live mode → derive from real tool calls; Mock mode → showcase fixtures. */
  live?: boolean
}

export default function TodoPanel({ session, live = false }: TodoPanelProps): JSX.Element {
  const todos: Todo[] = live ? deriveTodos(session.messages) : TODOS
  const completed = todos.filter((t) => t.status === 'completed').length
  const total = todos.length
```

  Then change the **one** remaining `TODOS` reference in the JSX body — the `{TODOS.map(...)}`
  list (line 46) → `{todos.map(...)}`. The `{completed} / {total}` line and the `total === 0`
  guard already read the new locals; the `runningTools` section is unchanged. **Keep the `TODOS`
  import** — it is still used in Mock mode.

- [ ] In `RightPanel.tsx`, accept and forward `live`:

```tsx
interface RightPanelProps {
  session: Session
  live?: boolean
  onClose: () => void
}

export function RightPanel({ session, live = false, onClose }: RightPanelProps): JSX.Element {
```

  and pass it down: `<TodoPanel session={session} live={live} />`.

- [ ] Run `npm run typecheck` → green.

---

## Task 5 — Feed `DiffView` from derived changes (live) + wire in `App.tsx`

**Files:** `src/renderer/views/diffs/DiffView.tsx`, `src/renderer/App.tsx`

Depends on Task 3. `DiffView` currently reads the global `FILE_CHANGES` and takes no props.

- [ ] In `DiffView.tsx`, accept `session` + `live` and compute the file list once:

```tsx
import { useState } from 'react'
import { FILE_CHANGES } from '@/mock/fixtures'
import type { Session, FileChange, DiffLine } from '@/mock/fixtures'
import { deriveChanges } from '@/cli/deriveSessionState'

interface DiffViewProps {
  session: Session
  live?: boolean
}

export default function DiffView({ session, live = false }: DiffViewProps): JSX.Element {
  const files: FileChange[] = live ? deriveChanges(session.messages) : FILE_CHANGES
  const [selectedFileId, setSelectedFileId] = useState<string>(
    files.length > 0 ? files[0].id : ''
  )

  const selectedFile = files.find((f) => f.id === selectedFileId)

  if (files.length === 0) {
```

  Then replace the remaining two `FILE_CHANGES` references in the body (the `files.length === 0`
  empty-state guard above, and `{FILE_CHANGES.map(...)}` → `{files.map(...)}`). `DiffContent` /
  `DiffLineRow` are unchanged.

  > Note: `selectedFileId` is seeded from the first render's `files`. When `live` flips or the
  > derived list changes, `selectedFile` may be `undefined` → the right pane just hides (the file
  > list still renders), which is acceptable for Slice B. A `useEffect` to re-seed selection is a
  > later polish, not required here.

- [ ] In `App.tsx`, pass the active session + live flag to `DiffView` (line ~421):

```tsx
      case 'changes':
        return <DiffView session={activeSession} live={liveMode} />
```

- [ ] In `App.tsx`, pass `live` to `RightPanel` (line ~522):

```tsx
                <RightPanel session={activeSession} live={liveMode} onClose={() => setRightOpen(false)} />
```

- [ ] Run the gate: `npm run typecheck && npm run test && npm run build` — all green.

---

## Parallelization Analysis

- **Files per task (disjoint check):**
  - T1: `fixtures.ts`
  - T2: `cli/streamMapper.ts`, `cli/streamMapper.test.ts`
  - T3: `cli/deriveSessionState.ts`, `cli/deriveSessionState.test.ts`
  - T4: `views/tasks/TodoPanel.tsx`, `layout/RightPanel.tsx`
  - T5: `views/diffs/DiffView.tsx`, `App.tsx`
  - No file is touched by two tasks → no write conflicts.
- **Dependencies:** T2→T1, T3→T1, T4→T3, T5→T3. T2 and T3 are independent of each other; T4 and
  T5 are independent of each other.
- **Batches:**
  - **Batch 1:** T1 (the type change everything builds on).
  - **Batch 2 (parallel):** T2 ∥ T3 (both need T1, disjoint files).
  - **Batch 3 (parallel):** T4 ∥ T5 (both need T3, disjoint files).
- **Critical path:** T1 → T3 → T4 (or T5), length 3.

Given the plan is small and tightly coupled through one type change, inline sequential execution
(T1→T2→T3→T4→T5) is the simplest and saves little wall-clock vs. batching. Parallelism is
available (T2∥T3, T4∥T5) if desired.

## Out of scope (YAGNI)
- KanbanBoard from real data (P4 — persistence + board state).
- Real unified/LCS diff (Slice B uses a naive remove-then-add block per edit).
- Re-seeding `DiffView` selection on list change (cosmetic polish).
- Partial-message token deltas / auto-read while streaming (Slice C).
