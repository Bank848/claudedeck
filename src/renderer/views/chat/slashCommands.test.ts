import { describe, it, expect } from 'vitest'
import { SLASH_COMMANDS, slashQuery, matchSlashCommands, moveIndex } from './slashCommands'

describe('SLASH_COMMANDS data integrity', () => {
  it('every command name starts with "/" and has a description', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.name.startsWith('/')).toBe(true)
      expect(c.name.length).toBeGreaterThan(1)
      expect(c.desc.trim().length).toBeGreaterThan(0)
    }
  })

  it('has unique command names', () => {
    const names = SLASH_COMMANDS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('slashQuery', () => {
  it('returns null when the value does not start with "/"', () => {
    expect(slashQuery('hello')).toBeNull()
    expect(slashQuery('')).toBeNull()
    expect(slashQuery(' /help')).toBeNull()
  })

  it('returns "" for a bare slash (show full list)', () => {
    expect(slashQuery('/')).toBe('')
  })

  it('returns the partial command name being typed', () => {
    expect(slashQuery('/he')).toBe('he')
    expect(slashQuery('/model')).toBe('model')
  })

  it('returns null once a space is typed (command chosen, args follow)', () => {
    expect(slashQuery('/model opus')).toBeNull()
    expect(slashQuery('/help ')).toBeNull()
  })
})

describe('matchSlashCommands', () => {
  it('returns [] when the menu should not show', () => {
    expect(matchSlashCommands('hello')).toEqual([])
    expect(matchSlashCommands('/model opus')).toEqual([])
  })

  it('returns the full list for a bare slash', () => {
    expect(matchSlashCommands('/')).toEqual(SLASH_COMMANDS)
  })

  it('prefix-matches the command name (case-insensitive)', () => {
    const r = matchSlashCommands('/CO')
    expect(r.map((c) => c.name)).toEqual(['/compact', '/config', '/cost'])
  })

  it('ranks name-prefix hits above description substring hits', () => {
    // "/me" prefixes "/memory"; "context" appears in /clear's & /compact's desc
    const r = matchSlashCommands('/me')
    expect(r[0].name).toBe('/memory')
  })

  it('falls back to description matches when no name matches', () => {
    const r = matchSlashCommands('/diagnostics')
    expect(r.map((c) => c.name)).toContain('/doctor')
  })

  it('returns [] for a non-matching fragment', () => {
    expect(matchSlashCommands('/zzzznope')).toEqual([])
  })
})

describe('moveIndex', () => {
  it('wraps forward', () => {
    expect(moveIndex(0, 3, 1)).toBe(1)
    expect(moveIndex(2, 3, 1)).toBe(0)
  })

  it('wraps backward', () => {
    expect(moveIndex(0, 3, -1)).toBe(2)
    expect(moveIndex(1, 3, -1)).toBe(0)
  })

  it('is safe for an empty list', () => {
    expect(moveIndex(0, 0, 1)).toBe(0)
  })
})
