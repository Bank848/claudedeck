import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'
// NOTE (vitest): this is the first runtime `electron`-value import in the codebase.
// Under vitest `app` is `undefined` (electron is externalized). That's fine ONLY because
// every exported fn takes an explicit path arg in tests and never hits the default-arg
// `indexFile()`/`projectsRoot()`. Do NOT add a top-level `app.getPath()` call — it would
// throw under test. Keep all `app` access inside functions, guarded by default args.

// Mirror of the renderer-side StoredSession in src/renderer/cli/types.ts — keep in sync
// (electron and renderer can't share the `@/` alias). Changing one means changing both.
export interface StoredSession {
  id: string
  claudeSessionId?: string
  cwd: string
  title: string
  model: string
  tokens: number
  contextTokens: number
  updatedAt: string
  createdAt: string
  open: boolean
}

/** ~/.claude/projects — where the CLI writes per-session JSONL transcripts. */
export function projectsRoot(): string {
  return join(homedir(), '.claude', 'projects')
}
function indexFile(): string {
  return join(app.getPath('userData'), 'sessions.json')
}

export function loadIndex(file = indexFile()): StoredSession[] {
  if (!existsSync(file)) return []
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(data) ? (data as StoredSession[]) : []
  } catch {
    try { renameSync(file, file + '.bak') } catch { /* best-effort */ }
    return []
  }
}

export function saveIndex(sessions: StoredSession[], file = indexFile()): void {
  // Write to a temp file then rename so a crash mid-write never corrupts the live file.
  const tmp = file + '.tmp'
  try {
    writeFileSync(tmp, JSON.stringify(sessions, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch {
    try { unlinkSync(tmp) } catch { /* best-effort cleanup */ }
    /* never throw on quit */
  }
}

/** Locate <uuid>.jsonl one level under the projects root. Returns abs path or null. */
export function findTranscript(root: string, uuid: string): string | null {
  if (!existsSync(root)) return null
  let dirs: string[]
  try { dirs = readdirSync(root) } catch { return null }
  for (const d of dirs) {
    const p = join(root, d)
    try { if (!statSync(p).isDirectory()) continue } catch { continue }
    const f = join(p, `${uuid}.jsonl`)
    if (existsSync(f)) return f
  }
  return null
}

/** Read a transcript by claude session uuid. null when absent/unreadable. */
export function readTranscript(uuid: string): string | null {
  const f = findTranscript(projectsRoot(), uuid)
  if (!f) return null
  try { return readFileSync(f, 'utf8') } catch { return null }
}
