import { describe, it, expect } from 'vitest'
import { AssistantMessage } from './AssistantMessage'
import { UserMessage } from './UserMessage'
import { sessionsReducer, type SessionsState } from '@/state/useSessions'
import type { ChatMessage } from '@/mock/fixtures'

// React.memo wraps components in an object with this $$typeof tag.
const REACT_MEMO = Symbol.for('react.memo')

describe('per-message memoization (perf: streaming re-renders)', () => {
  it('AssistantMessage is wrapped in React.memo', () => {
    expect((AssistantMessage as unknown as { $$typeof: symbol }).$$typeof).toBe(REACT_MEMO)
  })

  it('UserMessage is wrapped in React.memo', () => {
    expect((UserMessage as unknown as { $$typeof: symbol }).$$typeof).toBe(REACT_MEMO)
  })

  // The invariant React.memo relies on: folding a stream event must replace
  // ONLY the streaming message object — every other message keeps reference
  // identity, so memoized message components bail out of re-rendering.
  it("reducer 'event' preserves identity of non-streaming messages", () => {
    const done: ChatMessage = {
      id: 'a0', role: 'assistant', createdAt: '2026-06-08T00:00:00Z',
      parts: [{ kind: 'markdown', text: 'earlier answer' }],
    }
    const user: ChatMessage = {
      id: 'u1', role: 'user', createdAt: '2026-06-08T00:00:01Z',
      parts: [{ kind: 'markdown', text: 'hello' }],
    }
    const streaming: ChatMessage = {
      id: 'a1', role: 'assistant', createdAt: '2026-06-08T00:00:02Z',
      parts: [], streaming: true,
    }
    const s0: SessionsState = {
      sessions: [{
        id: 'x', title: 't', cwd: 'D:/p', status: 'running', model: 'opus-4-8',
        updatedAt: '', tokens: 0, messages: [done, user, streaming], terminalLines: [],
      }],
    }

    const s1 = sessionsReducer(s0, {
      type: 'event', sessionId: 'x',
      event: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] } },
    })

    const msgs = s1.sessions[0].messages
    expect(msgs[0]).toBe(done) // identity kept → memo bails out
    expect(msgs[1]).toBe(user) // identity kept → memo bails out
    expect(msgs[2]).not.toBe(streaming) // only the streaming message is replaced
    expect(msgs[2].parts).toEqual([{ kind: 'markdown', text: 'Hi!' }])
  })
})
