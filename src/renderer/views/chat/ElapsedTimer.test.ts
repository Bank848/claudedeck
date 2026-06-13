import { describe, it, expect } from 'vitest'
import { formatElapsed } from './ElapsedTimer'

describe('formatElapsed', () => {
  it('formats sub-minute as 0:SS with zero padding', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(5)).toBe('0:05')
    expect(formatElapsed(42)).toBe('0:42')
  })

  it('rolls over into minutes', () => {
    expect(formatElapsed(60)).toBe('1:00')
    expect(formatElapsed(95)).toBe('1:35')
    expect(formatElapsed(600)).toBe('10:00')
  })

  it('floors fractional seconds and clamps negatives', () => {
    expect(formatElapsed(42.9)).toBe('0:42')
    expect(formatElapsed(-3)).toBe('0:00')
  })
})
