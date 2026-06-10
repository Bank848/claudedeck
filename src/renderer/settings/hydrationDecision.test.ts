import { describe, it, expect } from 'vitest'
import { decideHydration, isLoadError, type LoadResult } from './hydrationDecision'

describe('isLoadError', () => {
  it('recognizes the error sentinel only', () => {
    expect(isLoadError({ __error: true })).toBe(true)
    expect(isLoadError(null)).toBe(false)
    expect(isLoadError({})).toBe(false)
    expect(isLoadError({ readAloud: true })).toBe(false)
  })
})

describe('decideHydration (#4 — load error must not be treated as first-run)', () => {
  it('applies the stored settings when the disk read succeeded', () => {
    const stored = { readAloud: true } as Record<string, unknown>
    expect(decideHydration(stored, true)).toEqual({
      applyStored: stored,
      seedDisk: false,
      hydrated: true,
    })
  })

  it('genuine first-run WITH a localStorage cache → seed disk from the cache', () => {
    expect(decideHydration(null, true)).toEqual({
      applyStored: null,
      seedDisk: true,
      hydrated: true,
    })
  })

  it('genuine first-run with NO cache → just mark hydrated (nothing to seed)', () => {
    expect(decideHydration(null, false)).toEqual({
      applyStored: null,
      seedDisk: false,
      hydrated: true,
    })
  })

  it('load ERROR → do not apply, do not seed, and do NOT mark hydrated', () => {
    // Leaving hydrated=false keeps the persist effect from ever writing this
    // session, so a transient read failure can never clobber the intact file.
    const r: LoadResult = { __error: true }
    expect(decideHydration(r, true)).toEqual({
      applyStored: null,
      seedDisk: false,
      hydrated: false,
    })
    expect(decideHydration(r, false).hydrated).toBe(false)
  })
})
