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
