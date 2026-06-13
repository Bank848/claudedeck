import { describe, it, expect } from 'vitest'
import { formatResetsIn } from './usage'

describe('formatResetsIn', () => {
  const base = new Date('2026-06-14T10:00:00Z')

  it('formats a future time within the same hour as Xh Ym', () => {
    const resetsAt = '2026-06-14T12:30:00Z'
    expect(formatResetsIn(resetsAt, base)).toBe('2h 30m')
  })

  it('formats a future time spanning multiple days as Xd Yh', () => {
    const resetsAt = '2026-06-18T14:00:00Z'
    expect(formatResetsIn(resetsAt, base)).toBe('4d 4h')
  })

  it('formats a future time just under 1 day as Xh Ym', () => {
    const resetsAt = '2026-06-15T09:45:00Z'
    expect(formatResetsIn(resetsAt, base)).toBe('23h 45m')
  })

  it('returns "now" for a past timestamp', () => {
    const resetsAt = '2026-06-14T09:00:00Z'
    expect(formatResetsIn(resetsAt, base)).toBe('now')
  })

  it('returns "now" for exactly now', () => {
    expect(formatResetsIn(base.toISOString(), base)).toBe('now')
  })

  it('handles 0 minutes remainder correctly', () => {
    const resetsAt = '2026-06-14T12:00:00Z'
    expect(formatResetsIn(resetsAt, base)).toBe('2h 0m')
  })

  it('formats exactly 1 day as 1d 0h', () => {
    const resetsAt = '2026-06-15T10:00:00Z'
    expect(formatResetsIn(resetsAt, base)).toBe('1d 0h')
  })
})
