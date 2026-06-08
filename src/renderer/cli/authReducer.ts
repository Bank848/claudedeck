import type { AuthStatus } from './authClient'

export type AuthPhase = 'idle' | 'opening' | 'awaiting-code' | 'submitting' | 'error'

export interface AuthState {
  status: AuthStatus
  phase: AuthPhase
  error?: string
}

export type AuthAction =
  | { type: 'set-status'; status: AuthStatus }
  | { type: 'login-start' }
  | { type: 'url' }
  | { type: 'submit' }
  | { type: 'login-error'; text: string }
  | { type: 'login-done'; ok: boolean; error?: string }
  | { type: 'cancel' }

export const initialAuthState: AuthState = { status: { loggedIn: false }, phase: 'idle' }

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'set-status':
      return { ...state, status: action.status, phase: action.status.loggedIn ? 'idle' : state.phase }
    case 'login-start':
      return { ...state, phase: 'opening', error: undefined }
    case 'url':
      return { ...state, phase: 'awaiting-code' }
    case 'submit':
      return { ...state, phase: 'submitting', error: undefined }
    case 'login-error':
      // Invalid code is NON-terminal: the CLI re-prompts on the same proc.
      return { ...state, phase: 'awaiting-code', error: action.text }
    case 'login-done':
      return action.ok
        ? { ...state, phase: 'idle', error: undefined }
        : { ...state, phase: 'error', error: action.error }
    case 'cancel':
      return { ...state, phase: 'idle', error: undefined }
    default:
      return state
  }
}
