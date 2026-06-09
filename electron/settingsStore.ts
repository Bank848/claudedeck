import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
// NOTE (vitest): like sessionStore, `app` is `undefined` under vitest (electron is
// externalized). Every exported fn takes an explicit path arg so tests never hit the
// default-arg `settingsFile()`. Keep all `app` access inside functions, guarded by
// default args — a top-level `app.getPath()` would throw under test.

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Parsed settings object, or null when the file is absent/corrupt. */
export function loadSettings(file = settingsFile()): Record<string, unknown> | null {
  if (!existsSync(file)) return null
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  } catch {
    try { renameSync(file, file + '.bak') } catch { /* best-effort */ }
    return null
  }
}

export function saveSettings(settings: Record<string, unknown>, file = settingsFile()): void {
  try { writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8') } catch { /* never throw on quit */ }
}
