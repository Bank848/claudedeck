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
  return raw
    .map((item, i): Todo => {
      const o = asRecord(item)
      return {
        id: `todo-${i}`,
        title: typeof o.content === 'string' ? o.content : '',
        status: asTodoStatus(o.status),
        activeForm: typeof o.activeForm === 'string' ? o.activeForm : undefined,
      }
    })
    .filter((t) => t.title.length > 0)
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
