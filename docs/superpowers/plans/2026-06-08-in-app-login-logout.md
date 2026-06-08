# Implementation Plan — In-app Login + Logout

**Design source of truth:** `docs/superpowers/specs/2026-06-08-in-app-login-logout-design.md`
(do not rewrite it — read it for the "why"). This plan is the executable "how".

## Goal

Let users log in / log out of the `claude` CLI **from inside ClaudeDeck**, and show
current account + login status. Approach B (verified): spawn `claude auth login --claudeai`
over pipes → grab OAuth URL → `shell.openExternal` → user pastes the callback code → write
to the child's stdin. Status via `claude auth status --json`. Logout via `claude auth logout`.

## Architecture

New `auth` IPC namespace parallel to `claude:*`. Main: `electron/auth.ts` holds one live
`loginProc`. Renderer: pure `cli/authReducer.ts` (phase machine) + `cli/authClient.ts`
(bridge) + `cli/useAuth.ts` (hook) feed a shared `components/LoginFlow.tsx`, reused by a
`components/LoginBanner.tsx` (top of chat, logged-out only) and a new Settings **Account**
section. `useAuth` is owned by `App` and passed to both consumers so login state is shared.

## Tech stack / conventions

- Mirror `electron/claude.ts` spawn pattern: Windows `cmd.exe /c bin ...args`, `windowsHide`,
  `taskkill /pid /T /F` for tree-kill. Reuse `detectClaude()` from `claude.ts`.
- Renderer mirrors `cli/claudeClient.ts` bridge style (`window.claudedeck?.auth`, guard absence).
- Tests: vitest, pure units only (no live OAuth — same boundary as Slice A). Match
  `electron/claude.test.ts` style.
- `window.claudedeck` typing auto-updates: the renderer's ambient decl uses
  `ClaudeDeckApi = typeof api` (preload), so adding `auth` to the preload `api` object
  propagates the type with no separate d.ts edit. (Verify: `claudeClient.ts` already uses
  `window.claudedeck?.claude` untyped-error-free.)
- Gate before commit: `npm run typecheck` + `npx vitest run` + `npm run build` all green.
  Commit via `git commit -F -`. **Push to main only after explicit user confirm.**

## File structure

```
electron/
  auth.ts                 (NEW — spawn + pure helpers)
  auth.test.ts            (NEW — unit tests)
  main.ts                 (EDIT — register auth:* IPC + before-quit cancelLogin)
  preload.ts              (EDIT — auth surface)
src/renderer/
  cli/
    authReducer.ts        (NEW — pure phase machine)
    authReducer.test.ts   (NEW — unit tests)
    authClient.ts         (NEW — bridge + AuthStatus type)
    useAuth.ts            (NEW — hook)
  components/
    LoginFlow.tsx         (NEW — per-phase login UI)
    LoginBanner.tsx       (NEW — logged-out banner)
  views/settings/
    SettingsView.tsx      (EDIT — Account section + LogoutButton, accept `auth` prop)
  App.tsx                 (EDIT — useAuth, mount LoginBanner, pass auth to SettingsView)
```

---

## Task 1 — `electron/auth.ts` (+ test) — main-process auth

**TDD: write `electron/auth.test.ts` first.**

- [ ] Create `electron/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractAuthUrl, parseAuthStatus, buildStatusArgs, buildLoginArgs, buildLogoutArgs } from './auth'

describe('extractAuthUrl', () => {
  it('extracts the authorize URL from the CLI hint line', () => {
    const line = "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz"
    expect(extractAuthUrl(line)).toBe('https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz')
  })
  it('returns null for unrelated lines', () => {
    expect(extractAuthUrl('Opening browser to sign in…')).toBeNull()
    expect(extractAuthUrl('')).toBeNull()
  })
})

describe('parseAuthStatus', () => {
  it('maps real logged-in JSON', () => {
    const json = JSON.stringify({
      loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty',
      email: 'a@b.com', orgName: 'Acme', subscriptionType: 'max',
    })
    expect(parseAuthStatus(json)).toEqual({
      loggedIn: true, email: 'a@b.com', plan: 'max', authMethod: 'claude.ai', orgName: 'Acme',
    })
  })
  it('returns loggedIn:false for loggedIn:false JSON', () => {
    expect(parseAuthStatus(JSON.stringify({ loggedIn: false }))).toEqual({ loggedIn: false })
  })
  it('returns loggedIn:false for garbage / empty', () => {
    expect(parseAuthStatus('not json')).toEqual({ loggedIn: false })
    expect(parseAuthStatus('')).toEqual({ loggedIn: false })
  })
  it('maps subscriptionType→plan even when email is absent', () => {
    const r = parseAuthStatus(JSON.stringify({ loggedIn: true, subscriptionType: 'pro' }))
    expect(r).toMatchObject({ loggedIn: true, plan: 'pro' })
    expect(r.email).toBeUndefined()
  })
})

describe('build*Args', () => {
  it('builds exact argv', () => {
    expect(buildStatusArgs()).toEqual(['auth', 'status', '--json'])
    expect(buildLoginArgs()).toEqual(['auth', 'login', '--claudeai'])
    expect(buildLogoutArgs()).toEqual(['auth', 'logout'])
  })
})
```

- [ ] Run the test — it must FAIL (module missing).
- [ ] Create `electron/auth.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { shell, type BrowserWindow } from 'electron'
import { detectClaude } from './claude'

export interface AuthStatus {
  loggedIn: boolean
  email?: string
  plan?: string
  authMethod?: string
  orgName?: string
}

let loginProc: ChildProcess | null = null

// ── pure helpers (unit-tested) ──────────────────────────────────────────────
const AUTH_URL_RE = /(https:\/\/claude\.com\/cai\/oauth\/authorize\?\S+)/

export function extractAuthUrl(line: string): string | null {
  const m = AUTH_URL_RE.exec(line)
  return m ? m[1] : null
}

export function parseAuthStatus(stdout: string): AuthStatus {
  try {
    const o = JSON.parse(stdout) as Record<string, unknown>
    if (!o || typeof o !== 'object' || !o.loggedIn) return { loggedIn: false }
    return {
      loggedIn: true,
      email: typeof o.email === 'string' ? o.email : undefined,
      plan: typeof o.subscriptionType === 'string' ? o.subscriptionType : undefined,
      authMethod: typeof o.authMethod === 'string' ? o.authMethod : undefined,
      orgName: typeof o.orgName === 'string' ? o.orgName : undefined,
    }
  } catch {
    return { loggedIn: false }
  }
}

export function buildStatusArgs(): string[] { return ['auth', 'status', '--json'] }
export function buildLoginArgs(): string[] { return ['auth', 'login', '--claudeai'] }
export function buildLogoutArgs(): string[] { return ['auth', 'logout'] }

// ── spawn helper (mirrors claude.ts) ────────────────────────────────────────
function spawnClaude(bin: string, args: string[]): ChildProcess {
  return process.platform === 'win32'
    ? spawn('cmd.exe', ['/c', bin, ...args], { windowsHide: true })
    : spawn(bin, args)
}

// ── status (read-only, never throws) ────────────────────────────────────────
export async function getAuthStatus(): Promise<AuthStatus> {
  const bin = await detectClaude()
  if (!bin) return { loggedIn: false }
  return new Promise((resolve) => {
    const p = spawnClaude(bin, buildStatusArgs())
    let out = ''
    p.stdout?.on('data', (d) => (out += String(d)))
    p.on('error', () => resolve({ loggedIn: false }))
    p.on('exit', () => resolve(parseAuthStatus(out)))
  })
}

// ── login (long-lived; waits for pasted code on stdin) ──────────────────────
export async function startLogin(win: BrowserWindow): Promise<{ ok: boolean; error?: string }> {
  const bin = await detectClaude()
  if (!bin) return { ok: false, error: 'claude CLI not found' }
  if (loginProc) cancelLogin() // restart any stale attempt

  const p = spawnClaude(bin, buildLoginArgs())
  loginProc = p
  let urlSent = false
  let buf = ''

  p.stdout?.on('data', (d) => {
    buf += String(d)
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!urlSent) {
        const url = extractAuthUrl(line)
        if (url) {
          urlSent = true
          win.webContents.send('auth:login-url', { url })
          void shell.openExternal(url)
        }
      }
    }
  })
  p.stderr?.on('data', (d) => {
    const text = String(d).trim()
    if (text) win.webContents.send('auth:login-error', { text })
  })
  p.on('error', (e) => {
    loginProc = null
    win.webContents.send('auth:login-done', { ok: false, error: e.message })
  })
  p.on('exit', (code) => {
    loginProc = null
    win.webContents.send('auth:login-done', { ok: code === 0, error: code === 0 ? undefined : `exited ${code}` })
  })
  return { ok: true }
}

export function submitLoginCode(code: string): { ok: boolean; error?: string } {
  if (!loginProc?.stdin) return { ok: false, error: 'no login in progress' }
  loginProc.stdin.write(code.trim() + '\n')
  return { ok: true }
}

export function cancelLogin(): void {
  const p = loginProc
  if (!p?.pid) return
  loginProc = null
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'])
  else p.kill('SIGTERM')
}

export async function logout(): Promise<{ ok: boolean; error?: string }> {
  const bin = await detectClaude()
  if (!bin) return { ok: false, error: 'claude CLI not found' }
  return new Promise((resolve) => {
    const p = spawnClaude(bin, buildLogoutArgs())
    p.on('error', (e) => resolve({ ok: false, error: e.message }))
    p.on('exit', (code) => resolve({ ok: code === 0 }))
  })
}
```

- [ ] Run `npx vitest run electron/auth.test.ts` — must PASS.

---

## Task 2 — `electron/main.ts` — register auth IPC

- [ ] Add import near the `./claude` import (line ~7):

```ts
import { getAuthStatus, startLogin, submitLoginCode, cancelLogin, logout } from './auth'
```

- [ ] In `registerIpc()`, after the `claude:cancel` handler (line ~329), add:

```ts
  // ── Auth (login/logout/status) ─────────────────────────────────────────────
  ipcMain.handle('auth:status', () => getAuthStatus())
  ipcMain.handle('auth:login-start', () => {
    if (!mainWindow) return { ok: false, error: 'no window' }
    return startLogin(mainWindow)
  })
  ipcMain.handle('auth:login-code', (_e, code: string) => submitLoginCode(code))
  ipcMain.handle('auth:login-cancel', () => {
    cancelLogin()
    return { ok: true }
  })
  ipcMain.handle('auth:logout', () => logout())
```

- [ ] **CRITICAL (review):** add `cancelLogin()` to **BOTH** teardown paths so a live login
  child is never orphaned. There are two handlers — `before-quit` (~line 350) AND
  `window-all-closed` (~line 355), and both already call `cancelAllTurns()` + `stopMiku()`.
  Add `cancelLogin()` next to those calls in **each**:

```ts
app.on('before-quit', () => {
  cancelAllTurns()
  cancelLogin()
  stopMiku()
})

app.on('window-all-closed', () => {
  cancelAllTurns()
  cancelLogin()
  stopMiku()
  if (process.platform !== 'darwin') app.quit()
})
```

(Match the existing body of `window-all-closed` — only ADD the `cancelLogin()` line; do not
change its existing quit logic.)

- [ ] `npm run typecheck` green.

---

## Task 3 — `electron/preload.ts` — auth surface

- [ ] Add `import type { AuthStatus } from './auth'` at top.
- [ ] Add this block to the `api` object after the `claude: { ... }` block (line ~93):

```ts
  /** In-app auth: login / logout / status (Approach B). */
  auth: {
    status: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:status'),
    startLogin: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:login-start'),
    submitCode: (code: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('auth:login-code', code),
    cancelLogin: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('auth:login-cancel'),
    logout: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:logout'),
    onUrl: (cb: (m: { url: string }) => void): (() => void) => {
      const l = (_e: unknown, m: { url: string }): void => cb(m)
      ipcRenderer.on('auth:login-url', l)
      return () => ipcRenderer.removeListener('auth:login-url', l)
    },
    onError: (cb: (m: { text: string }) => void): (() => void) => {
      const l = (_e: unknown, m: { text: string }): void => cb(m)
      ipcRenderer.on('auth:login-error', l)
      return () => ipcRenderer.removeListener('auth:login-error', l)
    },
    onDone: (cb: (m: { ok: boolean; error?: string }) => void): (() => void) => {
      const l = (_e: unknown, m: { ok: boolean; error?: string }): void => cb(m)
      ipcRenderer.on('auth:login-done', l)
      return () => ipcRenderer.removeListener('auth:login-done', l)
    },
  },
```

- [ ] `npm run typecheck` green (preload importing `AuthStatus` type-only is fine).

---

## Task 4 — `cli/authReducer.ts` (+ test) — pure phase machine

**TDD: write `src/renderer/cli/authReducer.test.ts` first.**

- [ ] Create `src/renderer/cli/authReducer.test.ts`:

```ts
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
```

- [ ] Run — must FAIL.
- [ ] Create `src/renderer/cli/authReducer.ts`:

```ts
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
```

- [ ] Run `npx vitest run src/renderer/cli/authReducer.test.ts` — must PASS.

---

## Task 5 — `cli/authClient.ts` + `cli/useAuth.ts`

- [ ] Create `src/renderer/cli/authClient.ts`:

```ts
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
```

- [ ] Create `src/renderer/cli/useAuth.ts`:

```ts
import { useCallback, useEffect, useReducer, useState } from 'react'
import { authReducer, initialAuthState } from './authReducer'
import * as auth from './authClient'
import { claudeAvailable } from './claudeClient'

export function useAuth() {
  const [state, dispatch] = useReducer(authReducer, initialAuthState)
  // GAP fix (review): surface "CLI not found" proactively, per the spec, rather
  // than only after a failed login click.
  const [cliAvailable, setCliAvailable] = useState(true)

  const refresh = useCallback(async () => {
    const status = await auth.status()
    dispatch({ type: 'set-status', status })
  }, [])

  useEffect(() => {
    void refresh()
    void claudeAvailable().then(setCliAvailable)
  }, [refresh])

  useEffect(() => {
    const offUrl = auth.onUrl(() => dispatch({ type: 'url' }))
    const offErr = auth.onError(({ text }) => dispatch({ type: 'login-error', text }))
    const offDone = auth.onDone(({ ok, error }) => {
      dispatch({ type: 'login-done', ok, error })
      if (ok) void refresh()
    })
    return () => {
      offUrl()
      offErr()
      offDone()
    }
  }, [refresh])

  const login = useCallback(async () => {
    dispatch({ type: 'login-start' })
    const r = await auth.startLogin()
    if (!r.ok) dispatch({ type: 'login-done', ok: false, error: r.error })
  }, [])

  const submitCode = useCallback(async (code: string) => {
    dispatch({ type: 'submit' })
    await auth.submitCode(code)
  }, [])

  const cancel = useCallback(async () => {
    await auth.cancelLogin()
    dispatch({ type: 'cancel' })
  }, [])

  const logout = useCallback(async () => {
    await auth.logout()
    await refresh()
  }, [refresh])

  return { ...state, cliAvailable, login, submitCode, cancel, logout, refresh }
}
```

- [ ] `npm run typecheck` green.

---

## Task 6 — `components/LoginFlow.tsx` — shared per-phase UI

- [ ] Create `src/renderer/components/LoginFlow.tsx`:

```tsx
import { useState } from 'react'
import type { useAuth } from '@/cli/useAuth'

type Auth = ReturnType<typeof useAuth>

/** Renders the right control for the current login phase. Reused by the
 *  logged-out banner and the Settings → Account section. */
export function LoginFlow({ auth }: { auth: Auth }): JSX.Element {
  const [code, setCode] = useState('')
  const { phase, error } = auth

  // GAP fix (review): proactive CLI-missing message per spec.
  if (!auth.cliAvailable) {
    return (
      <p className="text-sm text-fg-muted">
        Claude CLI not found — install Claude Code, then restart the app to log in.
      </p>
    )
  }

  if (phase === 'opening') {
    return <p className="text-sm text-fg-muted">Opening your browser to sign in…</p>
  }

  if (phase === 'awaiting-code' || phase === 'submitting') {
    const submitting = phase === 'submitting'
    return (
      <div className="space-y-2">
        <p className="text-sm text-fg-muted">
          We opened your browser. After approving, paste the code shown there:
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste code"
            aria-label="Login code"
            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
          <button
            disabled={!code.trim() || submitting}
            onClick={() => void auth.submitCode(code)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
          <button
            onClick={() => void auth.cancel()}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    )
  }

  // idle or error → Log in button
  return (
    <div className="space-y-2">
      <button
        onClick={() => void auth.login()}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
      >
        Log in
      </button>
      {phase === 'error' && error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
```

- [ ] `npm run typecheck` green.

---

## Task 7 — `components/LoginBanner.tsx` + mount in `App.tsx`

- [ ] Create `src/renderer/components/LoginBanner.tsx`:

```tsx
import { useState } from 'react'
import { LogIn, X } from 'lucide-react'
import type { useAuth } from '@/cli/useAuth'
import { LoginFlow } from './LoginFlow'

type Auth = ReturnType<typeof useAuth>

/** Top-of-chat banner shown only when logged out. Dismissible for the session. */
export function LoginBanner({ auth }: { auth: Auth }): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false)
  if (auth.status.loggedIn || dismissed) return null
  return (
    <div className="border-b border-border bg-surface px-4 py-2">
      <div className="flex items-center gap-3 text-sm">
        <LogIn size={16} className="text-accent" />
        <span className="flex-1 text-fg-muted">
          You&apos;re not logged in — Live mode needs a Claude account.
        </span>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="text-fg-muted hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-2">
        <LoginFlow auth={auth} />
      </div>
    </div>
  )
}
```

- [ ] In `src/renderer/App.tsx`:
  - Add imports:
    ```ts
    import { useAuth } from '@/cli/useAuth'
    import { LoginBanner } from '@/components/LoginBanner'
    ```
  - Inside the `App` component body (near other hooks), add: `const auth = useAuth()`
  - Mount the banner right after `<UpdateBanner />` (line ~475):
    ```tsx
    <UpdateBanner />
    <LoginBanner auth={auth} />
    ```
  - Pass `auth` to the settings view in `centerView` (find `case 'settings'`):
    ```tsx
    // was: return <SettingsView />
    return <SettingsView auth={auth} />
    ```

- [ ] `npm run typecheck` green.

---

## Task 8 — Settings → Account section (`SettingsView.tsx`)

- [ ] Add to the lucide import (line 2): `LogIn, LogOut` (keep existing icons).
- [ ] Add imports:
  ```ts
  import { LoginFlow } from '@/components/LoginFlow'
  import type { useAuth } from '@/cli/useAuth'
  ```
- [ ] Change the component signature:
  ```ts
  export default function SettingsView({ auth }: { auth: ReturnType<typeof useAuth> }): JSX.Element {
  ```
- [ ] Add a new `<Section>` immediately before the **About** section (line ~600):

```tsx
        <Section icon={<LogIn size={16} className="text-accent" />} title="Account">
          {auth.status.loggedIn ? (
            <>
              <Row label="Status" desc={auth.status.authMethod}>
                <span className="flex items-center gap-2 text-sm text-fg">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Logged in
                </span>
              </Row>
              <Row label="Account" desc={auth.status.plan ? `${auth.status.plan} plan` : undefined}>
                <span className="text-sm text-fg">{auth.status.email ?? '—'}</span>
              </Row>
              <Row label="Sign out" desc="Clears credentials on this machine">
                <LogoutButton onLogout={() => void auth.logout()} />
              </Row>
            </>
          ) : (
            <div className="px-4 py-3">
              <LoginFlow auth={auth} />
            </div>
          )}
        </Section>
```

- [ ] Add the `LogoutButton` helper near the `Section`/`Row` helpers at the bottom of the file:

```tsx
function LogoutButton({ onLogout }: { onLogout: () => void }): JSX.Element {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 3000)
    return () => clearTimeout(t)
  }, [confirm])
  return (
    <button
      onClick={() => (confirm ? onLogout() : setConfirm(true))}
      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
    >
      <LogOut size={14} /> {confirm ? 'Click to confirm' : 'Log out'}
    </button>
  )
}
```

(`useState`/`useEffect` are already imported at the top of SettingsView.)

- [ ] **Full gate:** `npm run typecheck` && `npx vitest run` && `npm run build` — all green.

---

## Parallelization analysis

Dependency-driven batches (tasks touching disjoint files run concurrently):

- **Batch 1 (parallel — all new, disjoint files):** Task 1 (`electron/auth.ts`+test),
  Task 4 (`cli/authReducer.ts`+test), Task 5a (`cli/authClient.ts`).
  *Note:* `authReducer.ts` imports the `AuthStatus` type from `authClient.ts`, so if split
  across agents, create `authClient.ts` first or stub the type — safest to do Task 4+5a in one agent.
- **Batch 2 (parallel — depend on Batch 1):** Task 2 (`main.ts`, needs Task 1),
  Task 3 (`preload.ts`, needs Task 1's `AuthStatus`), Task 5b (`cli/useAuth.ts`, needs 4+5a).
  All three edit different files → safe to parallelize.
- **Batch 3 (sequential):** Task 6 (`LoginFlow.tsx`, needs `useAuth`).
- **Batch 4 (parallel — different files, both need Task 6):** Task 7 (`LoginBanner.tsx` +
  `App.tsx`) and Task 8 (`SettingsView.tsx`). No file overlap → concurrent.

**Critical path:** Task 1 → Task 3 → Task 5b(useAuth) → Task 6 → (Task 7 ∥ Task 8).
The two `.tsx` consumer edits are the only naturally-parallel UI work; the backend chain is
short. Given the small size, inline sequential execution is also reasonable.

## Manual verification (user, real Electron — can't be automated here)

1. Log out via terminal (`claude auth logout`), launch app → **LoginBanner** appears; Settings
   → Account shows logged-out + LoginFlow.
2. Click **Log in** → browser opens to the OAuth page; approve → copy the code.
3. Paste code → Submit → app refreshes → banner disappears, Account shows email + plan.
4. Settings → Account → **Log out** (click, then "Click to confirm") → banner returns.
5. Invalid code: paste wrong code → red "Invalid code…" stays, field re-usable.
