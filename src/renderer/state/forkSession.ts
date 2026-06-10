/**
 * Pure helper for the "fork conversation" feature. No React, no IPC — unit-testable.
 *
 * Fork = duplicate a session into a new tab in the SAME cwd, like the Claude app:
 * the conversation history is copied for display and the parent's claude session id
 * is carried over so the first turn can `--resume … --fork-session` (copy the
 * transcript to a fresh id, leaving the parent untouched). No git, no branch name.
 */
import type { Session } from '@/mock/fixtures'

/** Append " (fork)" once, so re-forking a fork doesn't stack the suffix endlessly. */
export function forkTitle(title: string): string {
  const base = title.trim() || 'New session'
  return base.endsWith('(fork)') ? base : `${base} (fork)`
}

/**
 * Build the new session object for a fork. Copies messages + context for display
 * and carries `claudeSessionId` with `forkPending` so the first turn forks the
 * transcript. `tokens` resets to 0 (the fork bills fresh); `contextTokens` carries
 * because the resumed context is the same size. Always idle + open.
 */
export function buildForkedSession(source: Session, newId: string, now: Date): Session {
  const iso = now.toISOString()
  return {
    id: newId,
    title: forkTitle(source.title),
    cwd: source.cwd,
    status: 'idle',
    model: source.model,
    updatedAt: iso,
    createdAt: iso,
    open: true,
    tokens: 0,
    contextTokens: source.contextTokens ?? 0,
    messages: [...source.messages],
    terminalLines: [],
    claudeSessionId: source.claudeSessionId,
    forkPending: source.claudeSessionId ? true : undefined,
  }
}
