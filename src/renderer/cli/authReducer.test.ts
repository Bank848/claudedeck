import { describe, it, expect } from 'vitest'
import { authReducer, initialAuthState, type AuthState } from './authReducer'

const s = initialAuthState

describe('authReducer', () => {
  it('login-start → opening, clears error', () => {
    const prev: AuthState = { ...s, phase: 'error', error: 'x' }
    expect(authReducer(prev, { type: 'login-start' })).toMatchObject({ phase: 'opening', error: undefined })
  })
  it('url → awaiting-code', () => {
    expect(authReducer({ ...s, phase: 'opening' }, { type: 'url' }).phase).toBe('awaiting-code')
  })
  it('submit → submitting', () => {
    expect(authReducer({ ...s, phase: 'awaiting-code' }, { type: 'submit' }).phase).toBe('submitting')
  })
  it('login-error stays in awaiting-code with message (non-terminal)', () => {
    const r = authReducer({ ...s, phase: 'submitting' }, { type: 'login-error', text: 'Invalid code' })
    expect(r).toMatchObject({ phase: 'awaiting-code', error: 'Invalid code' })
  })
  it('login-done ok → idle; not ok → error', () => {
    expect(authReducer({ ...s, phase: 'submitting' }, { type: 'login-done', ok: true }).phase).toBe('idle')
    expect(authReducer({ ...s, phase: 'submitting' }, { type: 'login-done', ok: false, error: 'e' }))
      .toMatchObject({ phase: 'error', error: 'e' })
  })
  it('cancel → idle', () => {
    expect(authReducer({ ...s, phase: 'awaiting-code' }, { type: 'cancel' }).phase).toBe('idle')
  })
  it('set-status logged-in forces phase idle', () => {
    const r = authReducer({ ...s, phase: 'submitting' }, { type: 'set-status', status: { loggedIn: true, email: 'a@b' } })
    expect(r).toMatchObject({ phase: 'idle', status: { loggedIn: true, email: 'a@b' } })
  })
  it('set-status logged-out keeps current phase', () => {
    const r = authReducer({ ...s, phase: 'opening' }, { type: 'set-status', status: { loggedIn: false } })
    expect(r.phase).toBe('opening')
  })
})
