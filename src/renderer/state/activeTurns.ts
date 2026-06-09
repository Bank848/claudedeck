/**
 * Per-session map of the currently-live turnId. The Stop control needs the
 * turnId to cancel, but handleSend only had it as a local var — so a hung turn
 * (CLI never emits `result`/exits) could never be stopped and the session stuck
 * 'running' forever (#2). This is the small, pure, immutable store App keeps in a
 * ref and the Stop button / "stop" voice command read from.
 */
export type ActiveTurns = Readonly<Record<string, string>>

/** Record (or replace) the live turn for a session. */
export function startActiveTurn(m: ActiveTurns, sessionId: string, turnId: string): ActiveTurns {
  return { ...m, [sessionId]: turnId }
}

/**
 * Clear the live turn for a session — but ONLY if `turnId` is still the current
 * one. A late `done` from an old turn must not wipe a newer turn that already
 * started for the same session.
 */
export function endActiveTurn(m: ActiveTurns, sessionId: string, turnId: string): ActiveTurns {
  if (m[sessionId] !== turnId) return m
  const { [sessionId]: _omit, ...rest } = m
  return rest
}

/** The live turnId for a session, or undefined if none. */
export function activeTurnFor(m: ActiveTurns, sessionId: string): string | undefined {
  return m[sessionId]
}
