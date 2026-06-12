import { describe, it, expect } from 'vitest'
import { rejectUnsafeUrl, rejectUnsafeUrlAllowLoopback } from './netGuard'

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

describe('rejectUnsafeUrlAllowLoopback', () => {
  it('allows http loopback hosts (local Miku TTS server)', () => {
    for (const u of [
      'http://127.0.0.1:5050',
      'http://127.0.0.1:5050/v1/audio/speech',
      'http://localhost:5050/x',
      'http://[::1]:5050/x',
      'https://127.0.0.1:5050/x',
    ]) {
      expect(rejectUnsafeUrlAllowLoopback(u)).toBeNull()
    }
  })

  it('allows a public https url', () => {
    expect(rejectUnsafeUrlAllowLoopback('https://api.example.com/v1/x')).toBeNull()
  })

  it('still rejects http to non-loopback hosts', () => {
    expect(rejectUnsafeUrlAllowLoopback('http://example.com/x')).toBe('only https allowed')
    expect(rejectUnsafeUrlAllowLoopback('http://192.168.1.5:5050/x')).toBe('only https allowed')
    expect(rejectUnsafeUrlAllowLoopback('http://169.254.169.254/latest/meta-data')).toBe(
      'only https allowed',
    )
  })

  it('still rejects private/metadata/unspecified hosts over https', () => {
    for (const u of [
      'https://10.0.0.5/x',
      'https://192.168.1.1/x',
      'https://172.16.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://0.0.0.0/x',
    ]) {
      expect(rejectUnsafeUrlAllowLoopback(u)).toBe('host not allowed')
    }
  })

  it('rejects non-http(s) schemes even on loopback', () => {
    expect(rejectUnsafeUrlAllowLoopback('ftp://127.0.0.1/x')).toBe('only https allowed')
    expect(rejectUnsafeUrlAllowLoopback('file:///etc/passwd')).toBe('only https allowed')
  })

  it('rejects an invalid url', () => {
    expect(rejectUnsafeUrlAllowLoopback('not a url')).toBe('invalid url')
  })
})
