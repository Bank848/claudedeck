import { describe, it, expect } from 'vitest'
import {
  VIEW_NAMES,
  STATUS,
  voiceGreeting,
  collectPrewarmPhrases,
} from './prewarmPhrases'
import { MODE_OPTIONS } from './permissionModes'
import { EFFORT_OPTIONS } from './effortLevels'

describe('voiceGreeting', () => {
  it('returns the Thai greeting when th', () => {
    expect(voiceGreeting(true)).toContain('เปิดผู้ช่วยเสียงแล้ว')
  })
  it('returns the English greeting when not th', () => {
    expect(voiceGreeting(false)).toBe('Voice control on. Say a command, or say help.')
  })
})

describe('collectPrewarmPhrases', () => {
  const phrases = collectPrewarmPhrases()

  it('includes both languages for every view name', () => {
    for (const v of Object.values(VIEW_NAMES)) {
      expect(phrases).toContain(v.th)
      expect(phrases).toContain(v.en)
    }
  })

  it('includes both languages for every status line', () => {
    for (const s of Object.values(STATUS)) {
      expect(phrases).toContain(s.th)
      expect(phrases).toContain(s.en)
    }
  })

  it('includes both greetings', () => {
    expect(phrases).toContain(voiceGreeting(true))
    expect(phrases).toContain(voiceGreeting(false))
  })

  it('includes mode confirmations in both languages (matches App formatting)', () => {
    for (const o of MODE_OPTIONS) {
      expect(phrases).toContain(`โหมด ${o.label}`)
      expect(phrases).toContain(o.label)
    }
  })

  it('includes effort confirmations in both languages (matches App formatting)', () => {
    for (const o of EFFORT_OPTIONS) {
      expect(phrases).toContain(`เอฟฟอร์ต ${o.label}`)
      expect(phrases).toContain(`Effort ${o.label}`)
    }
  })

  it('appends extra confirms and dedupes against the built-in sets', () => {
    const withExtras = collectPrewarmPhrases({ extraConfirms: ['ส่งแล้ว', 'แชท', 'แชท'] })
    expect(withExtras).toContain('ส่งแล้ว')
    // 'แชท' is already a view name → must appear exactly once despite duplicates
    expect(withExtras.filter((p) => p === 'แชท')).toHaveLength(1)
  })

  it('drops empty / whitespace-only phrases', () => {
    const result = collectPrewarmPhrases({ extraConfirms: ['', '   ', 'ส่งแล้ว'] })
    expect(result).not.toContain('')
    expect(result.every((p) => p.trim().length > 0)).toBe(true)
  })

  it('returns a unique, non-empty list', () => {
    expect(phrases.length).toBeGreaterThan(0)
    expect(new Set(phrases).size).toBe(phrases.length)
  })
})
