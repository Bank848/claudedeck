import { spawn, type ChildProcess } from 'node:child_process'
import type { BrowserWindow } from 'electron'
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
          // The CLI opens the browser itself ("Opening browser to sign in…"),
          // so we must NOT open it again — otherwise the user gets two OAuth
          // tabs. We only capture the URL to advance the UI phase (and as a
          // fallback the renderer can surface it).
          urlSent = true
          win.webContents.send('auth:login-url', { url })
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
