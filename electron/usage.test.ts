import { describe, it, expect, vi } from 'vitest'
import { parseCreds, mapUsage, fetchUsage } from './usage'

const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

// ── parseCreds ───────────────────────────────────────────────────────────────

describe('parseCreds', () => {
  it('extracts token + tier fields from valid JSON', () => {
    const json = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'abc123',
        subscriptionType: 'max',
        rateLimitTier: 'max_20x',
      },
    })
    expect(parseCreds(json)).toEqual({
      token: 'abc123',
      subscriptionType: 'max',
      rateLimitTier: 'max_20x',
    })
  })

  it('returns empty object when claudeAiOauth key is missing', () => {
    expect(parseCreds(JSON.stringify({ someOther: {} }))).toEqual({})
  })

  it('returns empty object for malformed JSON', () => {
    expect(parseCreds('not-json')).toEqual({})
    expect(parseCreds('')).toEqual({})
  })

  it('returns empty object when accessToken is not a string', () => {
    const json = JSON.stringify({ claudeAiOauth: { accessToken: 123 } })
    const result = parseCreds(json)
    expect(result.token).toBeUndefined()
  })

  it('omits optional fields when absent', () => {
    const json = JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } })
    const result = parseCreds(json)
    expect(result.token).toBe('tok')
    expect(result.subscriptionType).toBeUndefined()
    expect(result.rateLimitTier).toBeUndefined()
  })

  it('extracts refreshToken + expiresAt for token refresh', () => {
    const json = JSON.stringify({
      claudeAiOauth: { accessToken: 'tok', refreshToken: 'refresh-xyz', expiresAt: 1781391905212 },
    })
    const result = parseCreds(json)
    expect(result.refreshToken).toBe('refresh-xyz')
    expect(result.expiresAt).toBe(1781391905212)
  })
})

// ── mapUsage ─────────────────────────────────────────────────────────────────

const FULL_RAW = {
  five_hour: { utilization: 82.0, resets_at: '2026-06-13T19:19:59.395635+00:00' },
  seven_day: { utilization: 10.0, resets_at: '2026-06-18T13:59:59+00:00' },
  seven_day_opus: null,
  seven_day_sonnet: { utilization: 0.0, resets_at: '2026-06-18T14:00:00+00:00' },
  extra_usage: {
    is_enabled: false,
    monthly_limit: null,
    used_credits: null,
    utilization: null,
    currency: null,
    disabled_reason: null,
  },
}

describe('mapUsage', () => {
  it('maps full payload correctly', () => {
    const result = mapUsage(FULL_RAW, { subscriptionType: 'max', rateLimitTier: 'max_20x' })
    expect(result.fiveHour).toEqual({ utilization: 82.0, resetsAt: '2026-06-13T19:19:59.395635+00:00' })
    expect(result.sevenDay).toEqual({ utilization: 10.0, resetsAt: '2026-06-18T13:59:59+00:00' })
    expect(result.sevenDayOpus).toBeNull()
    expect(result.sevenDaySonnet).toEqual({ utilization: 0.0, resetsAt: '2026-06-18T14:00:00+00:00' })
    expect(result.extraUsageEnabled).toBe(false)
    expect(result.subscriptionType).toBe('max')
    expect(result.rateLimitTier).toBe('max_20x')
  })

  it('returns null for null window entries', () => {
    const raw = { ...FULL_RAW, five_hour: null, seven_day: null, seven_day_sonnet: null }
    const result = mapUsage(raw, {})
    expect(result.fiveHour).toBeNull()
    expect(result.sevenDay).toBeNull()
    expect(result.sevenDaySonnet).toBeNull()
  })

  it('returns null window when utilization is not a number', () => {
    const raw = { ...FULL_RAW, five_hour: { utilization: 'bad', resets_at: '2026-06-13T19:00:00Z' } }
    expect(mapUsage(raw, {}).fiveHour).toBeNull()
  })

  it('returns null window when resets_at is missing', () => {
    const raw = { ...FULL_RAW, five_hour: { utilization: 50 } }
    expect(mapUsage(raw, {}).fiveHour).toBeNull()
  })

  it('handles missing extra_usage gracefully', () => {
    const { extra_usage: _x, ...raw } = FULL_RAW
    expect(mapUsage(raw, {}).extraUsageEnabled).toBe(false)
  })

  it('handles missing top-level keys (e.g. undefined raw)', () => {
    const result = mapUsage(undefined, {})
    expect(result.fiveHour).toBeNull()
    expect(result.sevenDay).toBeNull()
    expect(result.extraUsageEnabled).toBe(false)
  })

  it('extraUsageEnabled is true when is_enabled is true', () => {
    const raw = { ...FULL_RAW, extra_usage: { is_enabled: true } }
    expect(mapUsage(raw, {}).extraUsageEnabled).toBe(true)
  })
})

// ── fetchUsage ───────────────────────────────────────────────────────────────

const CREDS_JSON = JSON.stringify({
  claudeAiOauth: { accessToken: 'tok-abc', subscriptionType: 'max', rateLimitTier: 'max_20x' },
})

function makeReadFile(content: string | Error) {
  return async () => {
    if (content instanceof Error) throw content
    return content
  }
}

function makeFetch(status: number, body: unknown | Error) {
  return async () => {
    if (body instanceof Error) throw body
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response
  }
}

describe('fetchUsage', () => {
  it('returns usage on 200 ok', async () => {
    const result = await fetchUsage({
      readFileFn: makeReadFile(CREDS_JSON),
      fetchFn: makeFetch(200, FULL_RAW),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.usage.fiveHour?.utilization).toBe(82.0)
      expect(result.usage.subscriptionType).toBe('max')
    }
  })

  it('returns re-auth error on 401', async () => {
    const result = await fetchUsage({
      readFileFn: makeReadFile(CREDS_JSON),
      fetchFn: makeFetch(401, {}),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/re-auth|login/i)
  })

  it('returns error on 500', async () => {
    const result = await fetchUsage({
      readFileFn: makeReadFile(CREDS_JSON),
      fetchFn: makeFetch(500, {}),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/500/)
  })

  it('returns error on network throw', async () => {
    const result = await fetchUsage({
      readFileFn: makeReadFile(CREDS_JSON),
      fetchFn: makeFetch(0, new Error('ECONNREFUSED')),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('ECONNREFUSED')
  })

  it('returns error when creds file is missing', async () => {
    const result = await fetchUsage({
      readFileFn: makeReadFile(new Error('ENOENT')),
      fetchFn: makeFetch(200, FULL_RAW),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not signed in|credentials/i)
  })

  it('returns error when no token in creds', async () => {
    const noTokenCreds = JSON.stringify({ claudeAiOauth: { subscriptionType: 'max' } })
    const result = await fetchUsage({
      readFileFn: makeReadFile(noTokenCreds),
      fetchFn: makeFetch(200, FULL_RAW),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/token|login/i)
  })

  it('never throws — always returns UsageResult', async () => {
    await expect(fetchUsage({
      readFileFn: makeReadFile(new Error('boom')),
      fetchFn: makeFetch(0, new Error('boom')),
    })).resolves.toMatchObject({ ok: false })
  })

  it('surfaces re-auth error on 401 when no refreshToken present', async () => {
    const result = await fetchUsage({
      readFileFn: makeReadFile(CREDS_JSON),
      fetchFn: makeFetch(401, {}),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/re-auth|login|session expired/i)
  })
})

// ── fetchUsage: token refresh ─────────────────────────────────────────────────

const CREDS_WITH_REFRESH = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'stale-tok',
    refreshToken: 'refresh-xyz',
    expiresAt: 1781391905212, // far in the past
    subscriptionType: 'max',
    rateLimitTier: 'max_20x',
  },
})

/** Routes by URL: token endpoint → refresh response, usage endpoint → usage response. */
function makeRoutedFetch(opts: {
  usage: { status: number; body: unknown }[]
  refresh: { status: number; body: unknown }
}) {
  const usageQueue = [...opts.usage]
  const calls: string[] = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === TOKEN_URL) {
      return { ok: opts.refresh.status >= 200 && opts.refresh.status < 300, status: opts.refresh.status, json: async () => opts.refresh.body } as Response
    }
    const next = usageQueue.shift() ?? opts.usage[opts.usage.length - 1]
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body } as Response
  })
  return Object.assign(fn, { calls })
}

describe('fetchUsage token refresh', () => {
  it('proactively refreshes an expired token before calling usage, then succeeds', async () => {
    const written: string[] = []
    const fetchFn = makeRoutedFetch({
      usage: [{ status: 200, body: FULL_RAW }],
      refresh: { status: 200, body: { access_token: 'fresh-tok', refresh_token: 'refresh-new', expires_in: 3600 } },
    })
    const result = await fetchUsage({
      readFileFn: makeReadFile(CREDS_WITH_REFRESH),
      fetchFn,
      writeFileFn: async (_p, data) => { written.push(data) },
    })
    expect(result.ok).toBe(true)
    // token endpoint hit before usage
    expect(fetchFn.calls[0]).toContain(TOKEN_URL)
    // usage called with fresh token
    expect(fetchFn.mock.calls.some(([u, init]) =>
      u === USAGE_URL && String((init as RequestInit)?.headers && (init as any).headers.Authorization).includes('fresh-tok'),
    )).toBe(true)
    // rotated creds persisted with new access + refresh token
    expect(written.length).toBe(1)
    const saved = JSON.parse(written[0]).claudeAiOauth
    expect(saved.accessToken).toBe('fresh-tok')
    expect(saved.refreshToken).toBe('refresh-new')
    expect(saved.expiresAt).toBeGreaterThan(Date.now())
    // preserves untouched fields
    expect(saved.subscriptionType).toBe('max')
  })

  it('reactively refreshes on 401 then retries usage', async () => {
    // token not clock-expired, but server rejects → 401 → refresh → retry 200
    const notExpired = JSON.stringify({
      claudeAiOauth: { accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 },
    })
    const fetchFn = makeRoutedFetch({
      usage: [{ status: 401, body: {} }, { status: 200, body: FULL_RAW }],
      refresh: { status: 200, body: { access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 } },
    })
    const result = await fetchUsage({
      readFileFn: makeReadFile(notExpired),
      fetchFn,
      writeFileFn: async () => {},
    })
    expect(result.ok).toBe(true)
    expect(fetchFn.calls).toEqual([
      `GET ${USAGE_URL}`,
      `POST ${TOKEN_URL}`,
      `GET ${USAGE_URL}`,
    ])
  })

  it('surfaces re-auth error when refresh itself fails (invalid_grant)', async () => {
    const fetchFn = makeRoutedFetch({
      usage: [{ status: 401, body: {} }],
      refresh: { status: 400, body: { error: 'invalid_grant' } },
    })
    const result = await fetchUsage({
      readFileFn: makeReadFile(CREDS_WITH_REFRESH),
      fetchFn,
      writeFileFn: async () => {},
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/re-auth|login|session expired/i)
  })

  it('does not write creds when refresh fails', async () => {
    const written: string[] = []
    const fetchFn = makeRoutedFetch({
      usage: [{ status: 401, body: {} }],
      refresh: { status: 400, body: { error: 'invalid_grant' } },
    })
    await fetchUsage({
      readFileFn: makeReadFile(CREDS_WITH_REFRESH),
      fetchFn,
      writeFileFn: async (_p, data) => { written.push(data) },
    })
    expect(written.length).toBe(0)
  })
})
