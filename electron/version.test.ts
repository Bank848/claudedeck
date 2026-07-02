import { describe, it, expect } from 'vitest'
import { isNewer } from './version'

describe('isNewer (semver-precedence compare for the REST update path)', () => {
  it('a stable release is newer than its own pre-release (the live 0.2.0-beta.1 bug)', () => {
    expect(isNewer('0.2.0', '0.2.0-beta.1')).toBe(true)
  })

  it('a pre-release is NOT newer than the matching stable', () => {
    expect(isNewer('0.2.0-beta.1', '0.2.0')).toBe(false)
  })

  it('later beta beats earlier beta (numeric identifier compare)', () => {
    expect(isNewer('0.2.0-beta.2', '0.2.0-beta.1')).toBe(true)
  })

  it('beta beats alpha (lexical identifier compare)', () => {
    expect(isNewer('0.2.0-beta.1', '0.2.0-alpha.2')).toBe(true)
  })

  it('bigger minor beats smaller (numeric core, not lexical)', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
  })

  it('equal versions are not newer', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
  })

  // ── extra edge cases (semver §11) ──────────────────────────────────────────
  it('a pre-release with more identifiers beats one that is a strict prefix (1.0.0-alpha.1 > 1.0.0-alpha)', () => {
    expect(isNewer('1.0.0-alpha.1', '1.0.0-alpha')).toBe(true)
    expect(isNewer('1.0.0-alpha', '1.0.0-alpha.1')).toBe(false)
  })

  it('numeric identifiers have LOWER precedence than alphanumeric (1.0.0-1 < 1.0.0-alpha)', () => {
    expect(isNewer('1.0.0-alpha', '1.0.0-1')).toBe(true)
    expect(isNewer('1.0.0-1', '1.0.0-alpha')).toBe(false)
  })

  it('two equal pre-releases are not newer than each other', () => {
    expect(isNewer('1.0.0-rc.1', '1.0.0-rc.1')).toBe(false)
  })

  it('core comparison wins regardless of pre-release suffixes', () => {
    expect(isNewer('1.0.1-alpha', '1.0.0')).toBe(true)
    expect(isNewer('0.9.9', '1.0.0-beta.1')).toBe(false)
  })

  it('shorter core is padded with zeros (1.0 == 1.0.0)', () => {
    expect(isNewer('1.0', '1.0.0')).toBe(false)
    expect(isNewer('1.0.1', '1.0')).toBe(true)
  })

  it('tolerates junk core parts by treating them as 0 (does not throw)', () => {
    expect(() => isNewer('garbage', 'also-garbage')).not.toThrow()
    // 'garbage' core -> [0], no suffix; '1.0.0' core -> [1,0,0] -> newer
    expect(isNewer('1.0.0', 'garbage')).toBe(true)
  })
})
