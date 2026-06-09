import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from './settingsStore'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cds-settings-')) })

describe('settings round-trip', () => {
  it('save then load returns the same settings', () => {
    const file = join(dir, 'settings.json')
    const settings = { voiceChoiceId: 'miku:rvc', readAloud: true, speechRate: 1.2 }
    saveSettings(settings, file)
    expect(loadSettings(file)).toEqual(settings)
  })
  it('missing file → null', () => { expect(loadSettings(join(dir, 'none.json'))).toBeNull() })
  it('corrupt file → backed up + null', () => {
    const file = join(dir, 'settings.json'); writeFileSync(file, '{bad', 'utf8')
    expect(loadSettings(file)).toBeNull()
    expect(existsSync(file + '.bak')).toBe(true)
  })
  it('non-object JSON (array) → null', () => {
    const file = join(dir, 'settings.json'); writeFileSync(file, '[1,2,3]', 'utf8')
    expect(loadSettings(file)).toBeNull()
  })
})
