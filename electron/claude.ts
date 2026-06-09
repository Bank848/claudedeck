import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { safeSend } from './ipc'

export type PermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default'

/** Reasoning effort levels accepted by `claude --effort` (verified 2026-06-09). */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
const EFFORT_LEVELS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export interface StartTurnArgs {
  turnId: string
  prompt: string
  cwd: string
  sessionId?: string
  model?: string
  permissionMode: PermissionMode
  /** Optional reasoning effort. Omitted → the CLI picks its own default. */
  effort?: string
}

/**
 * Whitelist the effort value before it reaches argv. Anything not in the known
 * set (including undefined/'') is dropped so the CLI falls back to its default —
 * keeps `--effort` from ever carrying an unvalidated token.
 */
export function toCliEffort(e?: string): Effort | undefined {
  return e && (EFFORT_LEVELS as readonly string[]).includes(e) ? (e as Effort) : undefined
}

const turns = new Map<string, ChildProcess>()
let cachedBin: string | null | undefined // undefined = not probed, null = not found

/** Locate the claude binary once. Returns the resolved path, or null. */
export async function detectClaude(): Promise<string | null> {
  if (cachedBin !== undefined) return cachedBin
  cachedBin = await probe()
  return cachedBin
}

function probe(): Promise<string | null> {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const p = spawn(finder, ['claude'], { windowsHide: true })
    let out = ''
    p.stdout?.on('data', (d) => (out += String(d)))
    p.on('error', () => resolve(null))
    p.on('exit', (code) => {
      if (code !== 0) return resolve(null)
      const first = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0]
      resolve(first && existsSync(first) ? first : first || null)
    })
  })
}

/**
 * Map a ClaudeDeck model id (the fixture/picker id, e.g. `opus-4-8`) to a value
 * the real `claude --model` flag accepts. The CLI takes short aliases
 * (`opus`/`sonnet`/`haiku`) or full ids (`claude-opus-4-8`) — NOT `opus-4-8`.
 * Unknown values pass through (forward-compat with real aliases).
 */
const MODEL_ALIASES: Record<string, string> = {
  'opus-4-8': 'opus',
  'sonnet-4-6': 'sonnet',
  'haiku-4-5': 'haiku',
}
export function toCliModel(id?: string): string | undefined {
  if (!id) return undefined
  if (id in MODEL_ALIASES) return MODEL_ALIASES[id]
  return id
}

/** Use the requested cwd only if it exists; otherwise fall back to a real dir. */
export function pickCwd(
  requested: string | undefined,
  fallback: string,
  exists: (p: string) => boolean,
): string {
  return requested && exists(requested) ? requested : fallback
}

/**
 * The prompt is intentionally NOT here — it is fed over stdin (see startTurn) so
 * no user text ever reaches the command line. `claude -p` with the default
 * `--input-format text` reads the prompt from stdin. This makes Windows cmd.exe
 * metacharacter injection (`&`, `|`, `"`, …) impossible: every argv token below
 * is a fixed flag or a validated/enumerated value.
 */
export function buildArgs(a: StartTurnArgs): string[] {
  const model = toCliModel(a.model)
  const effort = toCliEffort(a.effort)
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', a.permissionMode,
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    ...(a.sessionId ? ['--resume', a.sessionId] : []),
  ]
}

/**
 * Spawn one turn. The prompt is written to the child's stdin (not argv), so even
 * though the .cmd shim is launched via `cmd.exe /c` on Windows, no user text is
 * ever parsed by cmd — shell-metacharacter injection is structurally impossible.
 */
export async function startTurn(win: BrowserWindow, a: StartTurnArgs): Promise<{ ok: boolean; error?: string }> {
  const bin = await detectClaude()
  if (!bin) return { ok: false, error: 'claude CLI not found' }

  // Fall back to a real directory rather than failing the turn outright; surface
  // the substitution so the user isn't surprised which cwd claude actually ran in.
  const cwd = pickCwd(a.cwd, process.cwd(), existsSync)
  if (cwd !== a.cwd) {
    safeSend(win,'claude:stderr', { turnId: a.turnId, text: `cwd "${a.cwd}" not found — using ${cwd}` })
  }

  const args = buildArgs(a)
  const isWin = process.platform === 'win32'
  const proc = isWin
    ? spawn('cmd.exe', ['/c', bin, ...args], { cwd, windowsHide: true })
    : spawn(bin, args, { cwd })

  turns.set(a.turnId, proc)

  // Feed the prompt over stdin (utf-8, so Thai survives) and close the stream so
  // claude -p stops waiting for more input and runs the turn.
  proc.stdin?.write(a.prompt, 'utf8')
  proc.stdin?.end()

  let buf = ''
  proc.stdout?.on('data', (d) => {
    buf += String(d)
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const event = JSON.parse(line)
        safeSend(win,'claude:event', { turnId: a.turnId, event })
      } catch {
        // Malformed line → surface to the terminal log, never throw.
        safeSend(win,'claude:stderr', { turnId: a.turnId, text: line })
      }
    }
  })
  proc.stderr?.on('data', (d) => safeSend(win,'claude:stderr', { turnId: a.turnId, text: String(d) }))
  proc.on('error', (e) => safeSend(win,'claude:stderr', { turnId: a.turnId, text: e.message }))
  proc.on('exit', (code) => {
    turns.delete(a.turnId)
    safeSend(win,'claude:done', { turnId: a.turnId, code: code ?? -1 })
  })

  return { ok: true }
}

/** Kill the process tree for a turn (best-effort; exit fires claude:done). */
export function cancelTurn(turnId: string): void {
  const proc = turns.get(turnId)
  if (!proc?.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
  else proc.kill('SIGTERM')
}

/** Kill every live turn (called on quit). */
export function cancelAllTurns(): void {
  for (const id of [...turns.keys()]) cancelTurn(id)
}
