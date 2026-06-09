import { cleanRules } from './claude'

/**
 * The persistent permission layer the user curates once (vs the per-turn
 * `--allowedTools` / `--add-dir` flags). Serialized to the `--settings` JSON
 * string the CLI accepts directly (no temp file needed).
 */
export interface PermissionSettings {
  allow?: string[]
  deny?: string[]
  ask?: string[]
  defaultMode?: string
  additionalDirectories?: string[]
}

/**
 * Serialize to the `--settings` JSON string. Returns undefined when nothing is
 * set (so the flag is omitted and the CLI uses its own config). Rule lists are
 * cleaned (trimmed, deduped, empties dropped) and empty arrays are omitted
 * rather than emitted as `[]`.
 */
export function buildSettingsJson(p?: PermissionSettings): string | undefined {
  if (!p) return undefined
  const permissions: Record<string, unknown> = {}
  for (const k of ['allow', 'deny', 'ask', 'additionalDirectories'] as const) {
    const v = cleanRules(p[k])
    if (v.length) permissions[k] = v
  }
  if (p.defaultMode) permissions.defaultMode = p.defaultMode
  if (Object.keys(permissions).length === 0) return undefined
  return JSON.stringify({ permissions })
}
