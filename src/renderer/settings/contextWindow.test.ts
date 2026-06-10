import { describe, it, expect } from 'vitest'
import { contextTokensOf, contextPct, crossed80, windowFor } from './contextWindow'
import type { TurnUsage } from '@/cli/types'

const u = (o: Partial<TurnUsage>): TurnUsage => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, ...o })

describe('contextWindow', () => {
  it('sums input + cacheRead + cacheCreation (NOT input alone)', () => {
    expect(contextTokensOf(u({ input: 2, cacheRead: 102703, cacheCreation: 742 }))).toBe(103447)
  })
  it('pct against the model window', () => {
    expect(contextPct(100000, 'opus-4-8')).toBeCloseTo(0.5, 5) // 200k window
  })
  it('auto-promotes to the 1M tier once usage exceeds the base window', () => {
    // 888k observed can only fit in a 1M context — denominator must scale, never exceed 100%
    expect(windowFor('opus-4-8', 888_000)).toBe(1_000_000)
    expect(contextPct(888_000, 'opus-4-8', 888_000)).toBeCloseTo(0.888, 3)
  })
  it('stays on the 200k tier for small sessions', () => {
    expect(windowFor('opus-4-8', 50_000)).toBe(200_000)
    expect(windowFor('opus-4-8')).toBe(200_000)
  })
  it('crossed80 fires only on the upward crossing', () => {
    expect(crossed80(0.79, 0.81)).toBe(true)
    expect(crossed80(0.81, 0.85)).toBe(false) // already above
    expect(crossed80(0.85, 0.40)).toBe(false) // dropped, no fire
  })
  it('drop below 80 resets so a later re-cross fires again', () => {
    expect(crossed80(0.40, 0.81)).toBe(true)
  })
})
