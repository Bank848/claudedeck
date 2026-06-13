import { describe, it, expect } from 'vitest'
import { sessionsReducer, emptySession, toStored, type SessionsState } from './useSessions'

function stateWith(...ids: string[]): SessionsState {
  return { sessions: ids.map((id) => emptySession(id)) }
}

describe('setAttention', () => {
  it('sets attention on the target session only', () => {
    const next = sessionsReducer(stateWith('a', 'b'), { type: 'setAttention', sessionId: 'a', attention: 'needsInput' })
    expect(next.sessions.find((s) => s.id === 'a')?.attention).toBe('needsInput')
    expect(next.sessions.find((s) => s.id === 'b')?.attention).toBeUndefined()
  })

  it('clears attention when attention is undefined', () => {
    const set = sessionsReducer(stateWith('a'), { type: 'setAttention', sessionId: 'a', attention: 'unread' })
    const cleared = sessionsReducer(set, { type: 'setAttention', sessionId: 'a', attention: undefined })
    expect(cleared.sessions[0].attention).toBeUndefined()
  })

  it('is a no-op (same state reference) when value is unchanged', () => {
    const base = stateWith('a') // attention already undefined
    const next = sessionsReducer(base, { type: 'setAttention', sessionId: 'a', attention: undefined })
    expect(next).toBe(base) // identity — no churn, no needless persist
  })

  it('is a no-op for an unknown session id', () => {
    const base = stateWith('a')
    const next = sessionsReducer(base, { type: 'setAttention', sessionId: 'zzz', attention: 'unread' })
    expect(next).toBe(base)
  })

  it('never persists attention (transient — absent from StoredSession)', () => {
    const set = sessionsReducer(stateWith('a'), { type: 'setAttention', sessionId: 'a', attention: 'needsInput' })
    const stored = toStored(set.sessions[0])
    expect('attention' in stored).toBe(false)
  })

  it('startTurn clears any prior attention', () => {
    const set = sessionsReducer(stateWith('a'), { type: 'setAttention', sessionId: 'a', attention: 'unread' })
    const um = { id: 'u', role: 'user' as const, createdAt: '', parts: [] }
    const am = { id: 'm', role: 'assistant' as const, createdAt: '', parts: [], streaming: true }
    const started = sessionsReducer(set, { type: 'startTurn', sessionId: 'a', userMessage: um, assistantMessage: am })
    expect(started.sessions[0].attention).toBeUndefined()
  })
})
