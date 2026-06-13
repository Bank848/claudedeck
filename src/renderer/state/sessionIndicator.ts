import type { Session } from '@/mock/fixtures'

/** The visual/aural state of a session's status dot, after applying precedence. */
export type IndicatorKind = 'needsInput' | 'error' | 'unread' | 'running' | 'idle' | 'active'

/**
 * Collapse `attention` + `status` into a single dot kind.
 * Precedence: needsInput > error > unread > status (running/idle/active).
 */
export function indicatorKind(session: Session): IndicatorKind {
  if (session.attention === 'needsInput') return 'needsInput'
  if (session.status === 'error') return 'error'
  if (session.attention === 'unread') return 'unread'
  return session.status // 'running' | 'idle' | 'active'
}

const LABELS: Record<IndicatorKind, string> = {
  needsInput: 'needs input',
  error: 'error',
  unread: 'unread',
  running: 'running',
  idle: 'idle',
  active: 'active',
}

/** Plain-text status word for aria-label / sr-only — never color alone (blind-first). */
export function indicatorLabel(session: Session): string {
  return LABELS[indicatorKind(session)]
}
