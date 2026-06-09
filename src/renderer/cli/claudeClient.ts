import type {
  ClaudeEvent, ClaudeStderrMsg, ClaudeDoneMsg, StartTurnRequest,
  PermissionRequestMsg, PermissionDecision,
} from './types'

function bridge() {
  return typeof window !== 'undefined' ? window.claudedeck?.claude : undefined
}

export function isClaudeManaged(): boolean {
  return !!bridge()
}

export async function claudeAvailable(): Promise<boolean> {
  return (await bridge()?.available()) ?? false
}

export async function startTurn(req: StartTurnRequest): Promise<{ ok: boolean; error?: string }> {
  return (await bridge()?.startTurn(req)) ?? { ok: false, error: 'claude bridge unavailable' }
}

export function cancelTurn(turnId: string): void {
  void bridge()?.cancelTurn(turnId)
}

/**
 * Answer a mid-turn tool-permission request for this turn. Resolves to the
 * main-process result: `ok:false` means the turn was already gone (its stdin was
 * closed) so the decision could not be delivered — the caller must surface that
 * rather than assume success (#1). No bridge → `ok:false` too.
 */
export async function respondPermission(
  turnId: string,
  id: string,
  decision: PermissionDecision,
  opts?: { input?: unknown; message?: string },
): Promise<{ ok: boolean }> {
  return (await bridge()?.respondPermission(turnId, id, decision, opts)) ?? { ok: false }
}

export interface TurnHandlers {
  onEvent: (event: ClaudeEvent) => void
  onStderr: (text: string) => void
  onDone: (code: number) => void
  /** A tool needs permission — render an Allow/Deny prompt. Optional. */
  onPermission?: (req: PermissionRequestMsg) => void
}

/** Subscribe to one turn's events; returns an unsubscribe fn. */
export function subscribe(turnId: string, h: TurnHandlers): () => void {
  const b = bridge()
  if (!b) return () => {}
  const offE = b.onEvent((m: { turnId: string; event: unknown }) => { if (m.turnId === turnId) h.onEvent(m.event as ClaudeEvent) })
  const offS = b.onStderr((m: ClaudeStderrMsg) => { if (m.turnId === turnId) h.onStderr(m.text) })
  const offD = b.onDone((m: ClaudeDoneMsg) => { if (m.turnId === turnId) h.onDone(m.code) })
  const offP = b.onPermissionRequest((m: PermissionRequestMsg) => { if (m.turnId === turnId) h.onPermission?.(m) })
  return () => { offE(); offS(); offD(); offP() }
}
