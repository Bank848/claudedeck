import { describe, it, expect } from 'vitest'
import { nextRovingIndex } from './Pill'

describe('nextRovingIndex', () => {
  it('wraps with ArrowDown/ArrowUp', () => {
    expect(nextRovingIndex(0, 3, 'ArrowDown')).toBe(1)
    expect(nextRovingIndex(2, 3, 'ArrowDown')).toBe(0)
    expect(nextRovingIndex(0, 3, 'ArrowUp')).toBe(2)
  })
  it('jumps with Home/End and ignores other keys', () => {
    expect(nextRovingIndex(1, 3, 'Home')).toBe(0)
    expect(nextRovingIndex(1, 3, 'End')).toBe(2)
    expect(nextRovingIndex(1, 3, 'a')).toBe(1)
  })
  it('returns -1 for an empty list', () => {
    expect(nextRovingIndex(0, 0, 'ArrowDown')).toBe(-1)
  })
})
