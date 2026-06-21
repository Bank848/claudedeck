import { describe, it, expect } from 'vitest'
import { sessionsReducer, initialSessionsState, emptySession, toStored, fromStored, type SessionsState } from './useSessions'
import type { ChatMessage } from '@/mock/fixtures'
import type { StoredSession } from '@/cli/types'

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
  it('seeds one empty idle session ready to type into', () => {
    const { sessions } = initialSessionsState()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].status).toBe('idle')
    expect(sessions[0].messages).toHaveLength(0)
    expect(sessions[0].terminalLines).toHaveLength(0)
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

  it('startTurn refreshes updatedAt so the active session bubbles to the top', () => {
    const s0 = stateWithSession('x')
    expect(s0.sessions[0].updatedAt).toBe('')
    const before = Date.now()
    const s1 = sessionsReducer(s0, {
      type: 'startTurn', sessionId: 'x', userMessage: userMsg, assistantMessage: asstMsg,
    })
    const ts = Date.parse(s1.sessions[0].updatedAt)
    expect(Number.isNaN(ts)).toBe(false)
    expect(ts).toBeGreaterThanOrEqual(before)
    // immutability: original untouched
    expect(s0.sessions[0].updatedAt).toBe('')
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

  it('setCwd updates only the target session cwd', () => {
    const s0: SessionsState = {
      sessions: [stateWithSession('a').sessions[0], stateWithSession('b').sessions[0]],
    }
    const otherCwd = s0.sessions[1].cwd
    const s1 = sessionsReducer(s0, { type: 'setCwd', sessionId: 'a', cwd: 'D:/new/path' })
    expect(s1.sessions[0].cwd).toBe('D:/new/path')
    expect(s1.sessions[1].cwd).toBe(otherCwd)
  })

  it('enqueue appends a queued message in FIFO order', () => {
    const s0 = stateWithSession('x')
    const s1 = sessionsReducer(s0, {
      type: 'enqueue', sessionId: 'x',
      message: { id: 'q1', text: 'first', modelId: 'opus-4-8' },
    })
    const s2 = sessionsReducer(s1, {
      type: 'enqueue', sessionId: 'x',
      message: { id: 'q2', text: 'second', modelId: 'opus-4-8' },
    })
    expect(s2.sessions[0].queued?.map((q) => q.id)).toEqual(['q1', 'q2'])
    // immutability: original untouched
    expect(s0.sessions[0].queued).toBeUndefined()
  })

  it('removeQueued drops the matching message by id', () => {
    const base = sessionsReducer(stateWithSession('x'), {
      type: 'enqueue', sessionId: 'x',
      message: { id: 'q1', text: 'a', modelId: 'opus-4-8' },
    })
    const withTwo = sessionsReducer(base, {
      type: 'enqueue', sessionId: 'x',
      message: { id: 'q2', text: 'b', modelId: 'opus-4-8' },
    })
    const after = sessionsReducer(withTwo, { type: 'removeQueued', sessionId: 'x', id: 'q1' })
    expect(after.sessions[0].queued?.map((q) => q.id)).toEqual(['q2'])
  })

  it('updateQueued edits the text of a queued message', () => {
    const base = sessionsReducer(stateWithSession('x'), {
      type: 'enqueue', sessionId: 'x',
      message: { id: 'q1', text: 'old', modelId: 'opus-4-8' },
    })
    const after = sessionsReducer(base, { type: 'updateQueued', sessionId: 'x', id: 'q1', text: 'new' })
    expect(after.sessions[0].queued?.[0].text).toBe('new')
  })

  it('removeQueued on an empty queue is a no-op (no throw)', () => {
    const s0 = stateWithSession('x')
    const after = sessionsReducer(s0, { type: 'removeQueued', sessionId: 'x', id: 'nope' })
    expect(after.sessions[0].queued ?? []).toEqual([])
  })

  it('enqueueFront inserts at the head (interrupt jumps the line)', () => {
    const withTwo = [
      { type: 'enqueue' as const, sessionId: 'x', message: { id: 'q1', text: 'a', modelId: 'opus-4-8' } },
      { type: 'enqueue' as const, sessionId: 'x', message: { id: 'q2', text: 'b', modelId: 'opus-4-8' } },
    ].reduce(sessionsReducer, stateWithSession('x'))
    const after = sessionsReducer(withTwo, {
      type: 'enqueueFront', sessionId: 'x',
      message: { id: 'q0', text: 'now', modelId: 'opus-4-8' },
    })
    expect(after.sessions[0].queued?.map((q) => q.id)).toEqual(['q0', 'q1', 'q2'])
  })

  it('removeQueued/updateQueued on an unknown session id is a no-op (no throw)', () => {
    const s0 = stateWithSession('x')
    expect(() => sessionsReducer(s0, { type: 'removeQueued', sessionId: 'nope', id: 'q1' })).not.toThrow()
    expect(() => sessionsReducer(s0, { type: 'updateQueued', sessionId: 'nope', id: 'q1', text: 't' })).not.toThrow()
  })
})

describe('session lifecycle', () => {
  it('createSession appends + marks open', () => {
    const s0 = { sessions: [emptySession('a')] }
    const s1 = sessionsReducer(s0, { type: 'createSession', session: emptySession('b') })
    expect(s1.sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })
  it('closeSession removes by id', () => {
    const s0 = { sessions: [emptySession('a'), emptySession('b')] }
    expect(sessionsReducer(s0, { type: 'closeSession', sessionId: 'a' }).sessions.map((s) => s.id)).toEqual(['b'])
  })
  it('hydrate replaces sessions from stored', () => {
    const stored = [{ id: 'x', cwd: 'D:/p', title: 'Old', model: 'opus-4-8', tokens: 9, contextTokens: 9, updatedAt: 'u', createdAt: 'c', open: true, claudeSessionId: 'uuid' }]
    const s1 = sessionsReducer({ sessions: [] }, { type: 'hydrate', stored })
    expect(s1.sessions[0]).toMatchObject({ id: 'x', title: 'Old', tokens: 9, claudeSessionId: 'uuid', messages: [] })
  })
  it('setUsage updates tokens + contextTokens', () => {
    const s0 = { sessions: [emptySession('a')] }
    const s1 = sessionsReducer(s0, { type: 'setUsage', sessionId: 'a', usage: { input: 2, output: 10, cacheRead: 100, cacheCreation: 0 } })
    expect(s1.sessions[0].contextTokens).toBe(102)
    expect(s1.sessions[0].tokens).toBe(10) // cumulative output
  })
  it('toStored/fromStored round-trip drops messages', () => {
    const s = { ...emptySession('a'), claudeSessionId: 'uuid', tokens: 3, contextTokens: 3, createdAt: 'c', open: true }
    expect(fromStored(toStored(s))).toMatchObject({ id: 'a', tokens: 3, messages: [], claudeSessionId: 'uuid' })
  })
  it('toStored/fromStored carries archived + pinned', () => {
    const s = { ...emptySession('a'), pinned: true, archived: false }
    expect(toStored(s)).toMatchObject({ pinned: true, archived: false })
    expect(fromStored(toStored(s))).toMatchObject({ pinned: true, archived: false })
  })
  it('fromStored defaults missing archived/pinned to false (old index migration-free)', () => {
    const legacy = { id: 'x', cwd: 'D:/p', title: 'Old', model: 'opus-4-8', tokens: 0, contextTokens: 0, updatedAt: 'u', createdAt: 'c', open: true } as StoredSession
    expect(fromStored(legacy)).toMatchObject({ archived: false, pinned: false })
  })
})

describe('library actions', () => {
  const open = (id: string, over = {}) => ({ ...emptySession(id), ...over })

  it('closeTab sets open:false without removing the session', () => {
    const s0 = { sessions: [open('a'), open('b')] }
    const s1 = sessionsReducer(s0, { type: 'closeTab', sessionId: 'a' })
    expect(s1.sessions.map((s) => s.id)).toEqual(['a', 'b'])
    expect(s1.sessions[0].open).toBe(false)
  })
  it('reopenTab sets open:true', () => {
    const s0 = { sessions: [open('a', { open: false })] }
    expect(sessionsReducer(s0, { type: 'reopenTab', sessionId: 'a' }).sessions[0].open).toBe(true)
  })
  it('togglePin flips pinned', () => {
    const s0 = { sessions: [open('a', { pinned: false })] }
    expect(sessionsReducer(s0, { type: 'togglePin', sessionId: 'a' }).sessions[0].pinned).toBe(true)
  })
  it('setArchived true archives AND closes the tab', () => {
    const s0 = { sessions: [open('a', { open: true })] }
    const s1 = sessionsReducer(s0, { type: 'setArchived', sessionId: 'a', archived: true })
    expect(s1.sessions[0]).toMatchObject({ archived: true, open: false })
  })
  it('setArchived false unarchives, leaving open untouched', () => {
    const s0 = { sessions: [open('a', { archived: true, open: false })] }
    const s1 = sessionsReducer(s0, { type: 'setArchived', sessionId: 'a', archived: false })
    expect(s1.sessions[0]).toMatchObject({ archived: false, open: false })
  })
})
