import type { Session } from '@/mock/fixtures'

export interface SessionGroup {
  /** Display key: the cwd basename (or 'Unknown' for blank cwd). */
  project: string
  /** Full cwd of the first session (for tooltip/aria). */
  cwd: string
  sessions: Session[]
}

function basename(cwd: string): string {
  return cwd.split(/[/\\]/).filter(Boolean).pop() || 'Unknown'
}

/** needsInput first, then pinned, then most-recently-updated. Stable for equal keys. */
function byAttentionThenPinThenRecency(a: Session, b: Session): number {
  const an = a.attention === 'needsInput'
  const bn = b.attention === 'needsInput'
  if (an !== bn) return an ? -1 : 1
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
  return (b.updatedAt || '').localeCompare(a.updatedAt || '')
}

/**
 * Filter by archived state + a free-text query (matches title or cwd basename,
 * case-insensitive), then bucket by project and sort within each bucket.
 * Groups are ordered by their most-recent session.
 */
export function groupSessions(
  sessions: Session[],
  opts: { query?: string; showArchived?: boolean } = {},
): SessionGroup[] {
  const q = (opts.query ?? '').trim().toLowerCase()
  const showArchived = opts.showArchived ?? false

  const visible = sessions.filter((s) => {
    if (!!s.archived !== showArchived) return false
    if (!q) return true
    return s.title.toLowerCase().includes(q) || basename(s.cwd).toLowerCase().includes(q)
  })

  const buckets = new Map<string, SessionGroup>()
  for (const s of visible) {
    const project = basename(s.cwd)
    const g = buckets.get(project) ?? { project, cwd: s.cwd, sessions: [] }
    g.sessions.push(s)
    buckets.set(project, g)
  }

  const groups = [...buckets.values()]
  for (const g of groups) g.sessions.sort(byAttentionThenPinThenRecency)
  groups.sort((a, b) => byAttentionThenPinThenRecency(a.sessions[0], b.sessions[0]))
  return groups
}

/**
 * The most-recently-updated sessions across ALL folders, newest first.
 *
 * Folder grouping buries a freshly-used session at the bottom of a crowded
 * bucket; this flat "Recent" list surfaces the last `limit` touched sessions
 * regardless of which folder they live in. Archived sessions are excluded;
 * pinning is ignored here (recency only) since pins already float inside groups.
 */
export function recentSessions(sessions: Session[], limit = 5): Session[] {
  return sessions
    .filter((s) => !s.archived)
    .slice()
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, Math.max(0, limit))
}
