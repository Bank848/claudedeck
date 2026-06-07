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

import { useReducer } from 'react'

export interface UseSessions {
  state: SessionsState
  dispatch: React.Dispatch<SessionsAction>
}

export function useSessions(): UseSessions {
  const [state, dispatch] = useReducer(sessionsReducer, undefined, initialSessionsState)
  return { state, dispatch }
}
