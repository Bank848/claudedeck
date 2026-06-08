// NOTE: must stay structurally in sync with `AuthStatus` in electron/auth.ts —
// they can't share a module across the main/renderer process boundary (mirrors
// how cli/types.ts mirrors electron/claude.ts).
export interface AuthStatus {
  loggedIn: boolean
  email?: string
  plan?: string
  authMethod?: string
  orgName?: string
}

function bridge() {
  return typeof window !== 'undefined' ? window.claudedeck?.auth : undefined
}

export async function status(): Promise<AuthStatus> {
  return (await bridge()?.status()) ?? { loggedIn: false }
}
export async function startLogin(): Promise<{ ok: boolean; error?: string }> {
  return (await bridge()?.startLogin()) ?? { ok: false, error: 'auth bridge unavailable' }
}
export async function submitCode(code: string): Promise<{ ok: boolean; error?: string }> {
  return (await bridge()?.submitCode(code)) ?? { ok: false, error: 'auth bridge unavailable' }
}
export async function cancelLogin(): Promise<{ ok: boolean }> {
  return (await bridge()?.cancelLogin()) ?? { ok: false }
}
export async function logout(): Promise<{ ok: boolean; error?: string }> {
  return (await bridge()?.logout()) ?? { ok: false, error: 'auth bridge unavailable' }
}
export function onUrl(cb: (m: { url: string }) => void): () => void {
  return bridge()?.onUrl(cb) ?? (() => {})
}
export function onError(cb: (m: { text: string }) => void): () => void {
  return bridge()?.onError(cb) ?? (() => {})
}
export function onDone(cb: (m: { ok: boolean; error?: string }) => void): () => void {
  return bridge()?.onDone(cb) ?? (() => {})
}
