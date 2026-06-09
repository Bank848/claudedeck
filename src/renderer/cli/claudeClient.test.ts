import { describe, it, expect } from 'vitest'
import { respondPermission, cancelTurn } from './claudeClient'

// Under vitest there is no `window.claudedeck` bridge, so the client must degrade
// gracefully instead of throwing.
describe('claudeClient.respondPermission (#1 — returns the delivery result)', () => {
  it('resolves to { ok: false } when no bridge is present', async () => {
    await expect(respondPermission('t1', 'req-1', 'allow')).resolves.toEqual({ ok: false })
  })
})

describe('claudeClient.cancelTurn', () => {
  it('is a no-op (does not throw) without a bridge', () => {
    expect(() => cancelTurn('t1')).not.toThrow()
  })
})
