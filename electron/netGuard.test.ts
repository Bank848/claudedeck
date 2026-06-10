import { describe, it, expect } from 'vitest'
import { rejectUnsafeUrl } from './netGuard'

describe('rejectUnsafeUrl', () => {
  it('allows a public https url', () => {
    expect(rejectUnsafeUrl('https://api.example.com/v1/x')).toBeNull()
  })

  it('rejects a non-https scheme', () => {
    expect(rejectUnsafeUrl('http://example.com')).toBe('only https allowed')
  })

  it('rejects an invalid url', () => {
    expect(rejectUnsafeUrl('not a url')).toBe('invalid url')
  })

  it('blocks loopback / localhost / link-local / private / metadata hosts', () => {
    for (const u of [
      'https://127.0.0.1/x',
      'https://localhost/x',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/x',
      'https://192.168.1.1/x',
      'https://172.16.0.1/x',
      'https://0.0.0.0/x',
      'https://[::1]/x',
    ]) {
      expect(rejectUnsafeUrl(u)).toBe('host not allowed')
    }
  })

  it('allows a public ipv4 literal over https', () => {
    expect(rejectUnsafeUrl('https://8.8.8.8/x')).toBeNull()
  })
})
