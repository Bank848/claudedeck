import { describe, it, expect } from 'vitest'
import { EFFORT_OPTIONS, effortLabel, effortFromVoice } from './effortLevels'

describe('effortLevels', () => {
  it('effortLabel returns the option label, Auto for undefined', () => {
    expect(effortLabel(undefined)).toBe('Auto')
    expect(effortLabel('high')).toBe('High')
    expect(effortLabel('max')).toBe('Max')
  })

  it('every option has a unique shortcut and non-empty phrases', () => {
    const shortcuts = EFFORT_OPTIONS.map((o) => o.shortcut)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    for (const o of EFFORT_OPTIONS) expect(o.phrases.length).toBeGreaterThan(0)
  })

  it('effortFromVoice matches TH + EN phrases, longest phrase wins', () => {
    expect(effortFromVoice('high effort please')?.effort).toBe('high')
    expect(effortFromVoice('เอฟฟอร์ตสูงสุด')?.effort).toBe('max')
    // 'extra high effort' also contains 'high effort' — the longer phrase wins.
    expect(effortFromVoice('extra high effort')?.effort).toBe('xhigh')
    // Auto is a real match → an option is returned whose effort is undefined (NOT null).
    const auto = effortFromVoice('ค่าเริ่มต้น')
    expect(auto).not.toBeNull()
    expect(auto?.effort).toBeUndefined()
    // No phrase matched → null (the single unambiguous "nothing" state).
    expect(effortFromVoice('สวัสดี')).toBeNull()
    // Identity: a match returns the actual EFFORT_OPTIONS object, not a fresh wrapper.
    expect(EFFORT_OPTIONS).toContain(effortFromVoice('max effort')!)
  })
})
