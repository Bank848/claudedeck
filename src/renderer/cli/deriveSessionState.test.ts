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
      { tool: 'Write', input: { file_path: 'a' } },          // no content → skipped
      { tool: 'Edit', input: { nope: 1 } },                   // no file_path → skipped
      { tool: 'Write', input: { file_path: 'b', content: 'c' } },
      { tool: 'Write', input: { file_path: 'e', content: 'f' } },
    ])])
    expect(changes.map((c) => c.path)).toEqual(['b', 'e'])
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
