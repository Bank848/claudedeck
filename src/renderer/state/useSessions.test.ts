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
