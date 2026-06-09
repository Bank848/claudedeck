import { describe, it, expect, beforeEach } from 'vitest'
import { cleanRules, loadPermissions, savePermissions, PERMISSIONS_KEY } from './permissionRules'

describe('cleanRules', () => {
  it('returns [] for undefined', () => {
    expect(cleanRules(undefined)).toEqual([])
  })

  it('trims each rule', () => {
    expect(cleanRules(['  Edit  ', 'Read'])).toEqual(['Edit', 'Read'])
  })

  it('drops empty / whitespace-only rules', () => {
    expect(cleanRules(['Edit', '', '   ', 'Read'])).toEqual(['Edit', 'Read'])
  })

  it('dedupes while preserving first-seen order', () => {
    expect(cleanRules(['Edit', 'Read', 'Edit', '  Read '])).toEqual(['Edit', 'Read'])
  })

  it('keeps pattern rules intact (spaces inside a rule are not split)', () => {
    expect(cleanRules(['Bash(git *)', 'mcp__renpy__*'])).toEqual(['Bash(git *)', 'mcp__renpy__*'])
  })
})

describe('loadPermissions / savePermissions', () => {
  // The test env is `node` (no DOM); provide a minimal localStorage shim.
  beforeEach(() => {
    const store = new Map<string, string>()
    ;(globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    } as Storage
  })

  it('returns an empty settings object when nothing is stored', () => {
    expect(loadPermissions()).toEqual({})
  })

  it('round-trips a saved settings object', () => {
    const p = { allow: ['Edit'], deny: ['WebFetch'], ask: ['Bash(rm *)'], defaultMode: 'plan', additionalDirectories: ['D:/lib'] }
    savePermissions(p)
    expect(loadPermissions()).toEqual(p)
  })

  it('survives malformed JSON in storage (returns {})', () => {
    localStorage.setItem(PERMISSIONS_KEY, '{not json')
    expect(loadPermissions()).toEqual({})
  })

  it('ignores a non-object stored value', () => {
    localStorage.setItem(PERMISSIONS_KEY, '"a string"')
    expect(loadPermissions()).toEqual({})
  })
})
