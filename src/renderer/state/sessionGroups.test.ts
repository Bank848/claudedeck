import { describe, it, expect } from 'vitest'
import type { Session } from '@/mock/fixtures'
import { groupSessions } from './sessionGroups'
import { emptySession } from './useSessions'

const mk = (id: string, over: Partial<ReturnType<typeof emptySession>> = {}) =>
  ({ ...emptySession(id), ...over })

describe('groupSessions', () => {
  it('buckets by cwd basename', () => {
    const g = groupSessions([
      mk('a', { cwd: 'D:/work/alpha', updatedAt: '2026-06-13T02:00:00Z' }),
      mk('b', { cwd: 'D:/work/beta', updatedAt: '2026-06-13T01:00:00Z' }),
      mk('c', { cwd: 'D:/work/alpha', updatedAt: '2026-06-13T03:00:00Z' }),
    ])
    expect(g.map((x) => x.project)).toEqual(['alpha', 'beta'])
    expect(g[0].sessions.map((s) => s.id)).toEqual(['c', 'a']) // recency desc
  })
  it('floats pinned to the top of a group', () => {
    const g = groupSessions([
      mk('a', { cwd: 'D:/p', updatedAt: '2026-06-13T03:00:00Z' }),
      mk('b', { cwd: 'D:/p', updatedAt: '2026-06-13T01:00:00Z', pinned: true }),
    ])
    expect(g[0].sessions.map((s) => s.id)).toEqual(['b', 'a'])
  })
  it('hides archived by default and shows them when asked', () => {
    const all = [mk('a', { cwd: 'D:/p' }), mk('b', { cwd: 'D:/p', archived: true })]
    expect(groupSessions(all).flatMap((g) => g.sessions.map((s) => s.id))).toEqual(['a'])
    expect(groupSessions(all, { showArchived: true }).flatMap((g) => g.sessions.map((s) => s.id))).toEqual(['b'])
  })
  it('query matches title or cwd basename, case-insensitive', () => {
    const all = [
      mk('a', { cwd: 'D:/p', title: 'Fix the parser' }),
      mk('b', { cwd: 'D:/renpy-thing', title: 'Other' }),
    ]
    expect(groupSessions(all, { query: 'PARSER' }).flatMap((g) => g.sessions.map((s) => s.id))).toEqual(['a'])
    expect(groupSessions(all, { query: 'renpy' }).flatMap((g) => g.sessions.map((s) => s.id))).toEqual(['b'])
  })
})

function s(partial: Partial<Session>): Session {
  return {
    id: 'x', title: 'x', cwd: 'D:/proj', status: 'idle', model: 'opus-4-8',
    updatedAt: '2026-06-14T00:00:00Z', tokens: 0, messages: [], terminalLines: [], ...partial,
  }
}

describe('groupSessions — needsInput float', () => {
  it('floats a needsInput session above a pinned + more-recent one', () => {
    const sessions = [
      s({ id: 'pinned', pinned: true, updatedAt: '2026-06-14T10:00:00Z' }),
      s({ id: 'needs', attention: 'needsInput', updatedAt: '2026-06-14T01:00:00Z' }),
      s({ id: 'plain', updatedAt: '2026-06-14T09:00:00Z' }),
    ]
    const order = groupSessions(sessions)[0].sessions.map((x) => x.id)
    expect(order[0]).toBe('needs')
  })

  it('keeps pinned-then-recency among non-needsInput sessions', () => {
    const sessions = [
      s({ id: 'old', updatedAt: '2026-06-14T01:00:00Z' }),
      s({ id: 'pin', pinned: true, updatedAt: '2026-06-14T00:00:00Z' }),
      s({ id: 'new', updatedAt: '2026-06-14T09:00:00Z' }),
    ]
    const order = groupSessions(sessions)[0].sessions.map((x) => x.id)
    expect(order).toEqual(['pin', 'new', 'old'])
  })

  it('unread does NOT float (only needsInput does)', () => {
    const sessions = [
      s({ id: 'unread', attention: 'unread', updatedAt: '2026-06-14T01:00:00Z' }),
      s({ id: 'recent', updatedAt: '2026-06-14T09:00:00Z' }),
    ]
    const order = groupSessions(sessions)[0].sessions.map((x) => x.id)
    expect(order).toEqual(['recent', 'unread'])
  })
})
