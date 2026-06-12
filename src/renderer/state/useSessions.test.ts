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
