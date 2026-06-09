/**
 * Pure framing for the claude CLI control protocol (stream-json input mode).
 * Shapes captured live against CLI v2.1.169 (see Task 5.0 spike in the plan).
 *
 * Flow on a turn that needs permission:
 *   client → {control_request initialize}          (once, first line)
 *   client → {user message}                        (the prompt — stdin only)
 *   CLI    → {control_request can_use_tool ...}     (mid-turn, per tool)
 *   client → {control_response allow|deny}
 *   CLI    → {result}                               (turn done; close stdin)
 *
 * Every function returns / accepts a SINGLE-LINE JSON string. The prompt lives
 * ONLY inside the user-message content — never on argv (injection-safe).
 */

export type PermissionDecision = 'allow' | 'deny'

/** Parsed can_use_tool request the renderer needs to render a prompt. */
export interface ControlRequest {
  id: string
  tool: string
  input: unknown
  toolUseId?: string
}

/** The initialize handshake line (sent once, before the user message). */
export function buildInitialize(): string {
  return JSON.stringify({
    type: 'control_request',
    request_id: 'init-1',
    request: { subtype: 'initialize' },
  })
}

/** The user-message envelope. The prompt is the content string and nothing else. */
export function buildUserMessage(prompt: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })
}

/**
 * Extract a can_use_tool control request. Returns null for everything else
 * (the initialize control_response, normal stream events, malformed input).
 */
export function parseControlRequest(evt: unknown): ControlRequest | null {
  if (!evt || typeof evt !== 'object') return null
  const e = evt as { type?: unknown; request_id?: unknown; request?: unknown }
  if (e.type !== 'control_request' || !e.request || typeof e.request !== 'object') return null
  const r = e.request as { subtype?: unknown; tool_name?: unknown; input?: unknown; tool_use_id?: unknown }
  if (r.subtype !== 'can_use_tool') return null
  return {
    id: String(e.request_id ?? ''),
    tool: String(r.tool_name ?? ''),
    input: r.input,
    toolUseId: typeof r.tool_use_id === 'string' ? r.tool_use_id : undefined,
  }
}

export interface ControlResponseOpts {
  /** For allow: the (possibly edited) tool input echoed back. */
  input?: unknown
  /** For deny: a human-readable reason. */
  message?: string
}

/** Build the control_response line answering a can_use_tool request. */
export function buildControlResponse(
  id: string,
  decision: PermissionDecision,
  opts: ControlResponseOpts = {},
): string {
  const inner =
    decision === 'allow'
      ? { behavior: 'allow', updatedInput: opts.input ?? {} }
      : { behavior: 'deny', message: opts.message ?? 'Denied by user.' }
  return JSON.stringify({
    type: 'control_response',
    response: { subtype: 'success', request_id: id, response: inner },
  })
}

/** True for the turn-completion `result` event (the signal to close stdin). */
export function isResultEvent(evt: unknown): boolean {
  return !!evt && typeof evt === 'object' && (evt as { type?: unknown }).type === 'result'
}

/** True for any control-protocol frame that must NOT be forwarded as a normal event. */
export function isControlFrame(evt: unknown): boolean {
  if (!evt || typeof evt !== 'object') return false
  const t = (evt as { type?: unknown }).type
  return t === 'control_request' || t === 'control_response' || t === 'control_cancel_request'
}
