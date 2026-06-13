import { beforeEach, describe, it, expect } from 'vitest'
import {
  DEFAULT_PERMISSION_MODE,
  loadPermissionMode, savePermissionMode,
  loadEffort, saveEffort,
} from './uiPrefs'

// The test env is `node` (no DOM), so provide a minimal in-memory localStorage.
function installLocalStorage(): void {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  } as Storage
}

describe('uiPrefs', () => {
  beforeEach(installLocalStorage)

  it('permission mode defaults to plan when unset', () => {
    expect(loadPermissionMode()).toBe('plan')
    expect(DEFAULT_PERMISSION_MODE).toBe('plan')
  })

  it('round-trips a saved permission mode', () => {
    savePermissionMode('bypassPermissions')
    expect(loadPermissionMode()).toBe('bypassPermissions')
  })

  it('ignores an invalid stored permission mode', () => {
    globalThis.localStorage.setItem('claudedeck.permissionMode', 'garbage')
    expect(loadPermissionMode()).toBe('plan')
  })

  it('effort defaults to undefined (Auto) when unset', () => {
    expect(loadEffort()).toBeUndefined()
  })

  it('round-trips a real effort level', () => {
    saveEffort('high')
    expect(loadEffort()).toBe('high')
  })

  it('persists Auto (undefined) as the auto sentinel, reloading as undefined', () => {
    saveEffort('max')
    saveEffort(undefined)
    expect(globalThis.localStorage.getItem('claudedeck.effort')).toBe('auto')
    expect(loadEffort()).toBeUndefined()
  })
})
