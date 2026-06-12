import { describe, it, expect } from 'vitest'
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
