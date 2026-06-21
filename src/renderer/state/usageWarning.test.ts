import { describe, it, expect } from 'vitest'
import { computeWarnings, initialWarnState, WARN_THRESHOLD } from './usageWarning'
import type { RealUsage } from './usage'

function usage(partial: Partial<RealUsage>): RealUsage {
  return {
    fiveHour: null,
    sevenDay: null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    extraUsageEnabled: false,
    ...partial,
  }
}

describe('computeWarnings', () => {
  it('treats utilization as a 0–100 percentage (threshold is 80, not 0.8)', () => {
    expect(WARN_THRESHOLD).toBe(80)
    const u = usage({ fiveHour: { utilization: 0.9, resetsAt: '2026-06-21T12:00:00Z' } })
    expect(computeWarnings(u, initialWarnState).signals).toHaveLength(0)
  })

  it('signals when a window is at or above the threshold', () => {
    const u = usage({ fiveHour: { utilization: 85, resetsAt: '2026-06-21T12:00:00Z' } })
    const { signals, next } = computeWarnings(u, initialWarnState)
    expect(signals.map((s) => s.key)).toEqual(['fiveHour'])
    expect(next.fiveHour).toBe('2026-06-21T12:00:00Z')
  })

  it('does not re-warn for the same reset cycle', () => {
    const u = usage({ fiveHour: { utilization: 85, resetsAt: '2026-06-21T12:00:00Z' } })
    const first = computeWarnings(u, initialWarnState)
    const second = computeWarnings(u, first.next)
    expect(second.signals).toHaveLength(0)
  })

  it('warns again once the window resets (resetsAt changes)', () => {
    const u1 = usage({ fiveHour: { utilization: 85, resetsAt: '2026-06-21T12:00:00Z' } })
    const first = computeWarnings(u1, initialWarnState)
    const u2 = usage({ fiveHour: { utilization: 82, resetsAt: '2026-06-21T17:00:00Z' } })
    const second = computeWarnings(u2, first.next)
    expect(second.signals.map((s) => s.key)).toEqual(['fiveHour'])
  })

  it('warns on both windows independently', () => {
    const u = usage({
      fiveHour: { utilization: 90, resetsAt: '2026-06-21T12:00:00Z' },
      sevenDay: { utilization: 95, resetsAt: '2026-06-28T00:00:00Z' },
    })
    const { signals } = computeWarnings(u, initialWarnState)
    expect(signals.map((s) => s.key).sort()).toEqual(['fiveHour', 'sevenDay'])
  })

  it('does not warn below threshold', () => {
    const u = usage({ fiveHour: { utilization: 79, resetsAt: '2026-06-21T12:00:00Z' } })
    expect(computeWarnings(u, initialWarnState).signals).toHaveLength(0)
  })
})
