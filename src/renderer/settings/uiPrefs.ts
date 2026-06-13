/**
 * Sticky composer UI preferences (permission mode + reasoning effort) that should
 * survive an app restart. These are the two controls users complained reset on
 * every relaunch: `permissionMode` always fell back to 'plan' and `effort` to Auto
 * because their React state was never persisted. Mirrors the load/save shape of
 * {@link ./permissionRules.ts}: best-effort localStorage, never throws.
 */
import type { Effort, PermissionMode } from '@/cli/types'

const MODE_KEY = 'claudedeck.permissionMode'
const EFFORT_KEY = 'claudedeck.effort'

const MODES: readonly PermissionMode[] = [
  'plan', 'acceptEdits', 'bypassPermissions', 'default', 'auto', 'dontAsk',
]
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Default mode when nothing is stored yet (matches the historic initial state). */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'plan'

/** Load the last-used permission mode, or the default if unset/invalid. */
export function loadPermissionMode(): PermissionMode {
  try {
    const raw = globalThis.localStorage?.getItem(MODE_KEY)
    if (raw && (MODES as readonly string[]).includes(raw)) return raw as PermissionMode
  } catch {
    /* storage unavailable — fall through */
  }
  return DEFAULT_PERMISSION_MODE
}

/** Persist the permission mode. Best-effort (swallows quota/SSR errors). */
export function savePermissionMode(mode: PermissionMode): void {
  try {
    globalThis.localStorage?.setItem(MODE_KEY, mode)
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Load the last-used effort. `undefined` (Auto, no --effort flag) is a real value,
 * so it is stored as the sentinel 'auto'; a missing/invalid key also yields undefined.
 */
export function loadEffort(): Effort | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(EFFORT_KEY)
    if (raw && (EFFORTS as readonly string[]).includes(raw)) return raw as Effort
  } catch {
    /* storage unavailable — fall through */
  }
  return undefined
}

/** Persist the effort. `undefined` (Auto) is stored as 'auto'. Best-effort. */
export function saveEffort(effort: Effort | undefined): void {
  try {
    globalThis.localStorage?.setItem(EFFORT_KEY, effort ?? 'auto')
  } catch {
    /* storage unavailable — non-fatal */
  }
}
