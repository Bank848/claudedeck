import { describe, it, expect } from 'vitest'
import { GUIDE, filterGuide } from './guide'

describe('GUIDE data integrity', () => {
  it('has unique section ids', () => {
    const ids = GUIDE.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every section has a non-empty title and at least one entry', () => {
    for (const s of GUIDE) {
      expect(s.title.trim().length).toBeGreaterThan(0)
      expect(s.entries.length).toBeGreaterThan(0)
    }
  })

  it('every entry has a non-empty command and desc', () => {
    for (const s of GUIDE) {
      for (const e of s.entries) {
        expect(e.command.trim().length).toBeGreaterThan(0)
        expect(e.desc.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('covers the four expected sections', () => {
    expect(GUIDE.map((s) => s.id).sort()).toEqual(['auth', 'cli', 'deck', 'slash'])
  })
})

describe('filterGuide', () => {
  it('returns all sections for an empty or blank query', () => {
    expect(filterGuide('')).toEqual(GUIDE)
    expect(filterGuide('   ')).toEqual(GUIDE)
  })

  it('matches by command (case-insensitive)', () => {
    const r = filterGuide('CLAUDE MCP')
    expect(r.some((s) => s.entries.some((e) => e.command.toLowerCase().includes('claude mcp')))).toBe(true)
  })

  it('matches by description', () => {
    const r = filterGuide('push-to-talk')
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((s) => s.entries.length > 0)).toBe(true)
  })

  it('matches by example text', () => {
    expect(filterGuide('summarize README').length).toBeGreaterThan(0)
  })

  it('drops sections with zero matching entries (push-to-talk is deck-only)', () => {
    // Depends on the literal "Push-to-talk" desc text living only in the deck section.
    expect(filterGuide('push-to-talk').map((s) => s.id)).toEqual(['deck'])
  })

  it('returns [] when nothing matches', () => {
    expect(filterGuide('zzz-no-such-token-zzz')).toEqual([])
  })

  it('returned sections always carry at least one entry', () => {
    for (const s of filterGuide('claude')) {
      expect(s.entries.length).toBeGreaterThan(0)
    }
  })
})
