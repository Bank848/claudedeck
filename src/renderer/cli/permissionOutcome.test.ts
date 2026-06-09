import { describe, it, expect } from 'vitest'
import { permissionResponseOutcome } from './permissionOutcome'

describe('permissionResponseOutcome (#1 — never fail an Allow/Deny silently)', () => {
  it('dequeues silently when the CLI accepted the response', () => {
    expect(permissionResponseOutcome(true)).toEqual({ dequeue: true, expired: false })
  })

  it('dequeues AND flags expired when the turn was already gone (stdin closed)', () => {
    // The turn died, so the prompt can never be answered — clear the stale head and
    // tell the user instead of leaving the modal up / failing in total silence.
    expect(permissionResponseOutcome(false)).toEqual({ dequeue: true, expired: true })
  })
})
