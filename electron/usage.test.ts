import { describe, it, expect } from 'vitest'
import { parseCreds, mapUsage, fetchUsage } from './usage'

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
})
