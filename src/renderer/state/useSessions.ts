import type { ChatMessage, Session, TerminalLine } from '@/mock/fixtures'
import { foldEvent } from '@/cli/streamMapper'
import type { ClaudeEvent } from '@/cli/types'
import type { QueuedMessage, StoredSession, TurnUsage } from '@/cli/types'
import { contextTokensOf } from '@/settings/contextWindow'

const MAX_TERMINAL_LINES = 500

export interface SessionsState {
  sessions: Session[]
}

export type SessionsAction =
  | { type: 'startTurn'; sessionId: string; userMessage: ChatMessage; assistantMessage: ChatMessage }
  | { type: 'event'; sessionId: string; event: ClaudeEvent }
  | { type: 'terminal'; sessionId: string; line: TerminalLine }
  | { type: 'finishTurn'; sessionId: string }
  | { type: 'setCwd'; sessionId: string; cwd: string }
  | { type: 'createSession'; session: Session }
  | { type: 'closeSession'; sessionId: string }
  | { type: 'hydrate'; stored: StoredSession[] }
  | { type: 'setTitle'; sessionId: string; title: string }
  | { type: 'setUsage'; sessionId: string; usage: TurnUsage }
  | { type: 'loadMessages'; sessionId: string; messages: ChatMessage[]; claudeSessionId?: string }
  | { type: 'closeTab'; sessionId: string }
  | { type: 'reopenTab'; sessionId: string }
  | { type: 'togglePin'; sessionId: string }
  | { type: 'setArchived'; sessionId: string; archived: boolean }
  | { type: 'enqueue'; sessionId: string; message: QueuedMessage }
  | { type: 'enqueueFront'; sessionId: string; message: QueuedMessage }
  | { type: 'removeQueued'; sessionId: string; id: string }
  | { type: 'updateQueued'; sessionId: string; id: string; text: string }

/**
 * A blank, ready-to-type session. The app boots into one of these — no mock
 * showcase data — so the composer is enabled (status 'idle', not 'running') and
 * the chat/todo/diff panels start from a clean empty state instead of demo
 * fixtures. cwd '' lets the main process fall back to its real working dir.
 */
export function emptySession(id: string): Session {
  const now = new Date().toISOString()
  return { id, title: 'New session', cwd: '', status: 'idle', model: 'opus-4-8', updatedAt: now, createdAt: now, open: true, archived: false, pinned: false, tokens: 0, contextTokens: 0, messages: [], terminalLines: [] }
}

export function toStored(s: Session): StoredSession {
  return { id: s.id, claudeSessionId: s.claudeSessionId, cwd: s.cwd, title: s.title, model: s.model, tokens: s.tokens, contextTokens: s.contextTokens ?? 0, updatedAt: s.updatedAt, createdAt: s.createdAt ?? s.updatedAt, open: s.open ?? true, archived: s.archived ?? false, pinned: s.pinned ?? false }
}

export function fromStored(s: StoredSession): Session {
  return { id: s.id, claudeSessionId: s.claudeSessionId, cwd: s.cwd, title: s.title, status: 'idle', model: s.model, tokens: s.tokens, contextTokens: s.contextTokens, updatedAt: s.updatedAt, createdAt: s.createdAt, open: s.open, archived: s.archived ?? false, pinned: s.pinned ?? false, messages: [], terminalLines: [] }
}

export function initialSessionsState(): SessionsState {
  return { sessions: [emptySession('main')] }
}

function patchSession(state: SessionsState, id: string, fn: (s: Session) => Session): SessionsState {
  return { sessions: state.sessions.map((s) => (s.id === id ? fn(s) : s)) }
}

export function sessionsReducer(state: SessionsState, action: SessionsAction): SessionsState {
  switch (action.type) {
    case 'startTurn':
      // Starting any turn consumes the one-shot fork flag (it only applies to the
      // first resume of a forked tab).
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        status: 'running',
        forkPending: undefined,
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

    case 'setCwd':
      return patchSession(state, action.sessionId, (s) => ({ ...s, cwd: action.cwd }))

    case 'createSession':
      return { sessions: [...state.sessions, action.session] }

    case 'closeSession':
      return { sessions: state.sessions.filter((s) => s.id !== action.sessionId) }

    case 'closeTab':
      // Soft: drop out of the tab strip, stay in the library. Never deletes.
      return patchSession(state, action.sessionId, (s) => ({ ...s, open: false }))

    case 'reopenTab':
      return patchSession(state, action.sessionId, (s) => ({ ...s, open: true }))

    case 'togglePin':
      return patchSession(state, action.sessionId, (s) => ({ ...s, pinned: !s.pinned }))

    case 'setArchived':
      // Archiving also closes the tab (an archived session can't be "open").
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        archived: action.archived,
        open: action.archived ? false : s.open,
      }))

    case 'enqueue':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        queued: [...(s.queued ?? []), action.message],
      }))

    case 'enqueueFront':
      // Interrupt: this message must be sent FIRST, ahead of anything already queued.
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        queued: [action.message, ...(s.queued ?? [])],
      }))

    case 'removeQueued':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        queued: (s.queued ?? []).filter((q) => q.id !== action.id),
      }))

    case 'updateQueued':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        queued: (s.queued ?? []).map((q) => (q.id === action.id ? { ...q, text: action.text } : q)),
      }))

    case 'hydrate':
      return { sessions: action.stored.map(fromStored) }

    case 'setTitle':
      return patchSession(state, action.sessionId, (s) => ({ ...s, title: action.title, updatedAt: new Date().toISOString() }))

    case 'loadMessages':
      return patchSession(state, action.sessionId, (s) => ({ ...s, messages: action.messages, claudeSessionId: action.claudeSessionId ?? s.claudeSessionId }))

    case 'setUsage':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        tokens: s.tokens + action.usage.output,
        contextTokens: contextTokensOf(action.usage),
        updatedAt: new Date().toISOString(),
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
