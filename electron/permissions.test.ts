import { describe, it, expect } from 'vitest'
import { buildSettingsJson } from './permissions'

describe('buildSettingsJson', () => {
  it('returns undefined for undefined / fully-empty input', () => {
    expect(buildSettingsJson(undefined)).toBeUndefined()
    expect(buildSettingsJson({})).toBeUndefined()
    expect(buildSettingsJson({ allow: [], deny: ['  '], ask: [] })).toBeUndefined()
  })

  it('serializes populated rule lists under permissions{}, cleaned', () => {
    const out = buildSettingsJson({
      allow: ['Edit', 'Edit', '  '],
      deny: ['WebFetch'],
      ask: ['Bash(rm *)'],
      additionalDirectories: ['D:/lib', ''],
    })
    expect(out).toBeTypeOf('string')
    const parsed = JSON.parse(out as string)
    expect(parsed.permissions.allow).toEqual(['Edit']) // trimmed + deduped + empties dropped
    expect(parsed.permissions.deny).toEqual(['WebFetch'])
    expect(parsed.permissions.ask).toEqual(['Bash(rm *)'])
    expect(parsed.permissions.additionalDirectories).toEqual(['D:/lib'])
  })

  it('includes defaultMode when set, and only when truthy', () => {
    const out = buildSettingsJson({ allow: ['Edit'], defaultMode: 'acceptEdits' })
    expect(JSON.parse(out as string).permissions.defaultMode).toBe('acceptEdits')
    // defaultMode alone (no rules) still produces a settings object
    const modeOnly = buildSettingsJson({ defaultMode: 'plan' })
    expect(JSON.parse(modeOnly as string).permissions.defaultMode).toBe('plan')
  })

  it('omits empty arrays rather than emitting []', () => {
    const out = buildSettingsJson({ allow: ['Edit'] })
    const parsed = JSON.parse(out as string)
    expect(parsed.permissions).not.toHaveProperty('deny')
    expect(parsed.permissions).not.toHaveProperty('ask')
    expect(parsed.permissions).not.toHaveProperty('additionalDirectories')
  })
})
