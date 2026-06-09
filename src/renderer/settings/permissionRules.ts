/**
 * Permission rule helpers shared by the tool-rules / directory / settings UIs.
 *
 * A "rule" is a single permission pattern token exactly as the claude CLI expects
 * it — e.g. `Edit`, `Bash(git *)`, `mcp__renpy__*`. Spaces *inside* a rule are
 * meaningful (they are part of the pattern), so we never split on whitespace;
 * each rule is one argv token downstream (see electron/claude.ts buildArgs).
 */

/** Drop empty/whitespace-only rules; trim each. Order preserved, dups removed. */
export function cleanRules(rules: readonly string[] | undefined): string[] {
  if (!rules) return []
  const out: string[] = []
  for (const r of rules) {
    const t = r.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/**
 * The persistent permission layer the user curates once. Mirrors
 * electron/permissions.ts PermissionSettings; sent to the CLI via `--settings`.
 */
export interface PermissionSettings {
  allow?: string[]
  deny?: string[]
  ask?: string[]
  defaultMode?: string
  additionalDirectories?: string[]
}

export const PERMISSIONS_KEY = 'claudedeck.permissions'

/**
 * Load curated permission settings from localStorage. Never throws: a missing
 * store, malformed JSON, or a non-object value all fall back to `{}`.
 */
export function loadPermissions(): PermissionSettings {
  try {
    const raw = globalThis.localStorage?.getItem(PERMISSIONS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as PermissionSettings
  } catch {
    return {}
  }
}

/** Persist curated permission settings. Best-effort (swallows quota/SSR errors). */
export function savePermissions(p: PermissionSettings): void {
  try {
    globalThis.localStorage?.setItem(PERMISSIONS_KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable — non-fatal */
  }
}
