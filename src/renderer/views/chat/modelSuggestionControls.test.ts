import { describe, it, expect } from 'vitest'
import { keyToChoice, trapTabIndex, voiceToChoice } from './modelSuggestionControls'

describe('keyToChoice', () => {
  it('Enter confirms the suggestion, Esc uses the resting model', () => {
    expect(keyToChoice('Enter', 'fable', 'opus')).toBe('fable')
    expect(keyToChoice('Escape', 'fable', 'opus')).toBe('opus')
  })
  it('returns null for other keys', () => {
    expect(keyToChoice('a', 'fable', 'opus')).toBeNull()
    expect(keyToChoice('Tab', 'fable', 'opus')).toBeNull()
  })
})

describe('trapTabIndex (4-button cycle)', () => {
  it('wraps forward', () => {
    expect(trapTabIndex(0, 4, false)).toBe(1)
    expect(trapTabIndex(3, 4, false)).toBe(0)
  })
  it('wraps backward on Shift+Tab', () => {
    expect(trapTabIndex(0, 4, true)).toBe(3)
    expect(trapTabIndex(2, 4, true)).toBe(1)
  })
})

describe('voiceToChoice', () => {
  it('"ใช้ตามแนะนำ" / confirm → suggested tier', () => {
    expect(voiceToChoice('ใช้ตามแนะนำ', 'fable', 'opus')).toBe('fable')
    expect(voiceToChoice('please confirm', 'sonnet', 'opus')).toBe('sonnet')
  })
  it('cancel / ยกเลิก → resting tier', () => {
    expect(voiceToChoice('ยกเลิก', 'fable', 'opus')).toBe('opus')
    expect(voiceToChoice('cancel that', 'fable', 'opus')).toBe('opus')
  })
  it('an explicit model name overrides', () => {
    expect(voiceToChoice('ใช้ haiku', 'fable', 'opus')).toBe('haiku')
    expect(voiceToChoice('โอปุส', 'fable', 'sonnet')).toBe('opus')
  })
  it('returns null when nothing matches', () => {
    expect(voiceToChoice('the weather is nice', 'fable', 'opus')).toBeNull()
  })
})
