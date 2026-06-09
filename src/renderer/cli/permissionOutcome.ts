/**
 * Policy for what to do after answering a mid-turn tool-permission request.
 *
 * The CLI's `respondPermission` returns `ok:false` when the turn is already gone
 * (its stdin was closed) — the control_response can't be delivered. Before this
 * helper the renderer dropped that result on the floor and dequeued anyway, so a
 * blind user pressing Allow/Deny on a dead turn got total silence. This encodes
 * the fix: always clear the un-answerable head, and flag `expired` so the caller
 * announces it (see App.tsx decidePermission, prewarmPhrases STATUS.expired).
 */
export interface PermissionResponseOutcome {
  /** Remove the head request from the queue (always — the prompt is now resolved or unanswerable). */
  dequeue: boolean
  /** The turn was already gone: tell the user instead of failing silently. */
  expired: boolean
}

export function permissionResponseOutcome(ok: boolean): PermissionResponseOutcome {
  return { dequeue: true, expired: !ok }
}
