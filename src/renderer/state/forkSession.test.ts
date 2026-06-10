import { describe, it, expect } from 'vitest'
import { forkTitle, buildForkedSession } from './forkSession'
import type { ChatMessage, Session } from '@/mock/fixtures'

const msg = (id: string): ChatMessage => ({ id, role: 'assistant', parts: [] } as unknown as ChatMessage)

const source: Session = {
  id: 's1',
  title: 'Dark-mode settings',
  cwd: 'D:/proj',
  status: 'running',
  model: 'opus-4-8',
  updatedAt: '2026-06-10T00:00:00.000Z',
  createdAt: '2026-06-09T00:00:00.000Z',
  open: true,
  tokens: 4781,
  contextTokens: 120000,
  messages: [msg('a'), msg('b')],
  terminalLines: [],
  claudeSessionId: 'claude-abc',
}

describe('forkTitle', () => {
  it('appends (fork) once', () => {
    expect(forkTitle('Dark-mode settings')).toBe('Dark-mode settings (fork)')
  })
  it('does not stack the suffix when re-forking a fork', () => {
    expect(forkTitle('Dark-mode settings (fork)')).toBe('Dark-mode settings (fork)')
  })
  it('falls back for an empty title', () => {
    expect(forkTitle('   ')).toBe('New session (fork)')
  })
})

describe('buildForkedSession', () => {
  const now = new Date('2026-06-10T20:44:39.000Z')
  const fork = buildForkedSession(source, 's2', now)

  it('keeps cwd + model and copies the conversation for display', () => {
    expect(fork.cwd).toBe('D:/proj')
    expect(fork.model).toBe('opus-4-8')
    expect(fork.messages).toEqual(source.messages)
    expect(fork.messages).not.toBe(source.messages) // a copy, not the same array
  })
  it('carries the parent claude session id and flags forkPending', () => {
    expect(fork.claudeSessionId).toBe('claude-abc')
    expect(fork.forkPending).toBe(true)
  })
  it('resets billing tokens but carries context occupancy', () => {
    expect(fork.tokens).toBe(0)
    expect(fork.contextTokens).toBe(120000)
  })
  it('is a fresh, idle, open tab with new timestamps', () => {
    expect(fork.id).toBe('s2')
    expect(fork.status).toBe('idle')
    expect(fork.open).toBe(true)
    expect(fork.createdAt).toBe('2026-06-10T20:44:39.000Z')
    expect(fork.terminalLines).toEqual([])
  })
  it('does not flag forkPending when the parent never started a claude session', () => {
    const fresh = buildForkedSession({ ...source, claudeSessionId: undefined }, 's3', now)
    expect(fresh.forkPending).toBeUndefined()
  })
})
