import { describe, it, expect } from 'vitest'
import {
  EFFORT_OPTIONS, DEFAULT_EFFORT, effortLabel, effortToStop, effortFromStop, effortFromVoice,
  type EffortLevel,
} from './effort'

describe('effort', () => {
  it('has 3 stops indexed 0..2 with the default in the middle', () => {
    expect(EFFORT_OPTIONS.map((e) => e.stop)).toEqual([0, 1, 2])
    expect(DEFAULT_EFFORT).toBe('medium')
    expect(effortToStop(DEFAULT_EFFORT)).toBe(1)
  })

  it('stop <-> level round-trips', () => {
    const levels: EffortLevel[] = ['faster', 'medium', 'smarter']
    for (const l of levels) expect(effortFromStop(effortToStop(l))).toBe(l)
    expect(effortLabel('smarter')).toBe('Smarter')
  })

  it('effortFromVoice matches TH + EN, longest phrase wins', () => {
    expect(effortFromVoice('เอฟฟอร์ตเร็ว')).toBe('faster')
    expect(effortFromVoice('make it smarter please')).toBe('smarter')
    expect(effortFromVoice('ปานกลาง')).toBe('medium')
    expect(effortFromVoice('สวัสดี')).toBeNull()
  })
})
