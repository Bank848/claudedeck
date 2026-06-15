import { readFile as nodeReadFile, writeFile as nodeWriteFile, rename as nodeRename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface UsageWindow { utilization: number; resetsAt: string }
export interface RealUsage {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  sevenDayOpus: UsageWindow | null
  sevenDaySonnet: UsageWindow | null
  extraUsageEnabled: boolean
  subscriptionType?: string
  rateLimitTier?: string
}
export type UsageResult = { ok: true; usage: RealUsage } | { ok: false; error: string }

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA = 'oauth-2025-04-20'

// OAuth refresh — same public client + endpoint the `claude` CLI uses. The usage
// page reads the on-disk access token, which the CLI lets expire (~8h) and only
// refreshes lazily on its own API calls. Without this, an expired token returns
// 401 forever even while the user is "logged in" (CLI still works). Verified the
// endpoint/client_id respond with invalid_grant (not invalid_client) for a bad
// refresh token, confirming both are correct.
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const EXPIRY_SKEW_MS = 30_000 // refresh slightly early to avoid a guaranteed-401 round trip

export interface Creds {
  token?: string
  refreshToken?: string
  expiresAt?: number
  subscriptionType?: string
  rateLimitTier?: string
}

export function parseCreds(text: string): Creds {
  try {
    const o = JSON.parse(text)?.claudeAiOauth ?? {}
    return {
      token: typeof o.accessToken === 'string' ? o.accessToken : undefined,
      refreshToken: typeof o.refreshToken === 'string' ? o.refreshToken : undefined,
      expiresAt: typeof o.expiresAt === 'number' ? o.expiresAt : undefined,
      subscriptionType: typeof o.subscriptionType === 'string' ? o.subscriptionType : undefined,
      rateLimitTier: typeof o.rateLimitTier === 'string' ? o.rateLimitTier : undefined,
    }
  } catch { return {} }
}

interface Refreshed { accessToken: string; refreshToken: string; expiresAt: number }

/** POSTs the refresh_token grant. Returns the rotated token set, or null on any failure. */
async function refreshAccessToken(refreshToken: string, doFetch: FetchFn): Promise<Refreshed | null> {
  let res: Response
  try {
    res = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: OAUTH_CLIENT_ID }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch { return null }
  if (!res.ok) return null
  try {
    const j = (await res.json()) as Record<string, unknown>
    if (typeof j.access_token !== 'string') return null
    return {
      accessToken: j.access_token,
      // refresh tokens rotate — keep the new one; fall back to the old if absent.
      refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : refreshToken,
      expiresAt: Date.now() + (typeof j.expires_in === 'number' ? j.expires_in * 1000 : 0),
    }
  } catch { return null }
}

/** Merges rotated tokens into the existing creds JSON, preserving every other field. */
export function applyRefreshed(credsText: string, r: Refreshed): string {
  const o = JSON.parse(credsText)
  o.claudeAiOauth = {
    ...(o.claudeAiOauth ?? {}),
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    expiresAt: r.expiresAt,
  }
  return JSON.stringify(o, null, 2)
}

export function mapUsage(raw: unknown, creds: { subscriptionType?: string; rateLimitTier?: string }): RealUsage {
  const r = raw as Record<string, unknown> | undefined
  const win = (w: unknown): UsageWindow | null => {
    const obj = w as Record<string, unknown> | null | undefined
    if (!obj || typeof obj.utilization !== 'number' || typeof obj.resets_at !== 'string') return null
    return { utilization: obj.utilization, resetsAt: obj.resets_at }
  }
  return {
    fiveHour: win(r?.five_hour),
    sevenDay: win(r?.seven_day),
    sevenDayOpus: win(r?.seven_day_opus),
    sevenDaySonnet: win(r?.seven_day_sonnet),
    extraUsageEnabled: !!(r?.extra_usage as Record<string, unknown> | null | undefined)?.is_enabled,
    subscriptionType: creds.subscriptionType,
    rateLimitTier: creds.rateLimitTier,
  }
}

const credsPath = (): string => join(homedir(), '.claude', '.credentials.json')

type ReadFileFn = (path: string, encoding: 'utf8') => Promise<string>
type WriteFileFn = (path: string, data: string) => Promise<void>
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** Atomic write (temp + rename) so a crash mid-write can't corrupt the credential
 *  store — a corrupt file would log the user out of every tool. */
const atomicWrite: WriteFileFn = async (path, data) => {
  const tmp = `${path}.tmp`
  await nodeWriteFile(tmp, data, { encoding: 'utf8', mode: 0o600 })
  await nodeRename(tmp, path)
}

export async function fetchUsage(
  deps: { readFileFn?: ReadFileFn; writeFileFn?: WriteFileFn; fetchFn?: FetchFn } = {},
): Promise<UsageResult> {
  const readFile = deps.readFileFn ?? ((p, e) => nodeReadFile(p, e))
  const writeFile = deps.writeFileFn ?? atomicWrite
  const doFetch = deps.fetchFn ?? globalThis.fetch.bind(globalThis)

  let credsText: string
  try { credsText = await readFile(credsPath(), 'utf8') }
  catch { return { ok: false, error: 'Not signed in (no credentials found). Run `claude auth login`.' } }

  const creds = parseCreds(credsText)
  if (!creds.token) return { ok: false, error: 'No OAuth token found. Run `claude auth login`.' }

  let token = creds.token
  let refreshed = false

  // Persist a successful refresh, mutating the local token + credsText so a later
  // reactive refresh sees the rotated refresh token. Best-effort: a write failure
  // must not break the (otherwise working) usage fetch.
  const applyAndPersist = async (r: Refreshed): Promise<void> => {
    token = r.accessToken
    refreshed = true
    try {
      credsText = applyRefreshed(credsText, r)
      await writeFile(credsPath(), credsText)
    } catch { /* keep the fresh token in memory even if we couldn't persist it */ }
  }

  // Proactive: the on-disk token is past (or near) expiry — refresh before the
  // call instead of eating a guaranteed 401.
  if (creds.refreshToken && creds.expiresAt !== undefined && Date.now() >= creds.expiresAt - EXPIRY_SKEW_MS) {
    const r = await refreshAccessToken(creds.refreshToken, doFetch)
    if (r) await applyAndPersist(r)
  }

  const getUsage = (bearer: string): Promise<Response> => doFetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${bearer}`, 'anthropic-beta': OAUTH_BETA },
    signal: AbortSignal.timeout(15_000),
  })

  let res: Response
  try { res = await getUsage(token) }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Network error' } }

  // Reactive: server rejected the token despite our clock check (e.g. revoked or
  // skewed expiry). Try one refresh + retry before giving up.
  if (res.status === 401 && creds.refreshToken && !refreshed) {
    const r = await refreshAccessToken(creds.refreshToken, doFetch)
    if (r) {
      await applyAndPersist(r)
      try { res = await getUsage(token) }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Network error' } }
    }
  }

  if (res.status === 401) return { ok: false, error: 'Session expired. Re-authenticate with `claude auth login`.' }
  if (res.status === 429) return { ok: false, error: 'Rate limited — wait a minute then retry.' }
  if (!res.ok) return { ok: false, error: `Usage API returned ${res.status}` }

  try {
    const raw = await res.json()
    return { ok: true, usage: mapUsage(raw, creds) }
  } catch { return { ok: false, error: 'Malformed usage response' } }
}
