import { readFile as nodeReadFile } from 'node:fs/promises'
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

export function parseCreds(text: string): { token?: string; subscriptionType?: string; rateLimitTier?: string } {
  try {
    const o = JSON.parse(text)?.claudeAiOauth ?? {}
    return {
      token: typeof o.accessToken === 'string' ? o.accessToken : undefined,
      subscriptionType: typeof o.subscriptionType === 'string' ? o.subscriptionType : undefined,
      rateLimitTier: typeof o.rateLimitTier === 'string' ? o.rateLimitTier : undefined,
    }
  } catch { return {} }
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
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export async function fetchUsage(
  deps: { readFileFn?: ReadFileFn; fetchFn?: FetchFn } = {},
): Promise<UsageResult> {
  const readFile = deps.readFileFn ?? ((p, e) => nodeReadFile(p, e))
  const doFetch = deps.fetchFn ?? globalThis.fetch.bind(globalThis)

  let credsText: string
  try { credsText = await readFile(credsPath(), 'utf8') }
  catch { return { ok: false, error: 'Not signed in (no credentials found). Run `claude auth login`.' } }

  const creds = parseCreds(credsText)
  if (!creds.token) return { ok: false, error: 'No OAuth token found. Run `claude auth login`.' }

  let res: Response
  try {
    res = await doFetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${creds.token}`, 'anthropic-beta': OAUTH_BETA },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Network error' } }

  if (res.status === 401) return { ok: false, error: 'Session expired. Re-authenticate with `claude auth login`.' }
  if (!res.ok) return { ok: false, error: `Usage API returned ${res.status}` }

  try {
    const raw = await res.json()
    return { ok: true, usage: mapUsage(raw, creds) }
  } catch { return { ok: false, error: 'Malformed usage response' } }
}
