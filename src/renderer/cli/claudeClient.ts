import type {
  ClaudeEvent, ClaudeStderrMsg, ClaudeDoneMsg, StartTurnRequest,
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

export interface TurnHandlers {
  onEvent: (event: ClaudeEvent) => void
  onStderr: (text: string) => void
  onDone: (code: number) => void
}

/** Subscribe to one turn's events; returns an unsubscribe fn. */
export function subscribe(turnId: string, h: TurnHandlers): () => void {
  const b = bridge()
  if (!b) return () => {}
  const offE = b.onEvent((m: { turnId: string; event: unknown }) => { if (m.turnId === turnId) h.onEvent(m.event as ClaudeEvent) })
  const offS = b.onStderr((m: ClaudeStderrMsg) => { if (m.turnId === turnId) h.onStderr(m.text) })
  const offD = b.onDone((m: ClaudeDoneMsg) => { if (m.turnId === turnId) h.onDone(m.code) })
  return () => { offE(); offS(); offD() }
}
