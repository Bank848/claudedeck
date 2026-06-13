import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { safeSend } from './ipc'
import { spawnCli } from './spawnCli'
import { buildSettingsJson, type PermissionSettings } from './permissions'
import {
  buildInitialize,
  buildUserMessage,
  buildControlResponse,
  parseControlRequest,
  isResultEvent,
  isControlFrame,
  type PermissionDecision,
  type ControlRequest,
  type ImageAttachment,
} from './permissionProtocol'

export type PermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default' | 'auto' | 'dontAsk'

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
  /** Per-turn tool allow rules (e.g. `Bash(git *)`, `Edit`). Each is one argv token. */
  allowedTools?: string[]
  /** Per-turn tool deny rules. Each is one argv token. */
  disallowedTools?: string[]
  /** Extra directories granted to claude this turn (`--add-dir`). Each is one argv token. */
  additionalDirs?: string[]
  /** Persistent permission settings, serialized to a single `--settings` JSON token. */
  settings?: PermissionSettings
  /** Which config layers to load (`--setting-sources`, e.g. `user,project,local`). */
  settingSources?: string
  /**
   * Resume by COPYING the parent transcript into a fresh session id (`--fork-session`)
   * instead of appending to it. Only meaningful alongside `sessionId`; used on the
   * first turn of a forked tab so two tabs never write the same transcript.
   */
  forkSession?: boolean
  /** Images to include as content blocks in the user message. */
  images?: ImageAttachment[]
}

/**
 * Drop empty/whitespace-only rules; trim each. Order preserved, dups removed.
 * Copy of src/renderer/settings/permissionRules.ts — main has no `@/` alias to
 * the renderer, so the helper is intentionally duplicated and tested on both
 * sides (see claude.test.ts + permissionRules.test.ts). Keep the two in sync.
 */
export function cleanRules(rules: readonly string[] | undefined): string[] {
  if (!rules) return []
  const out: string[] = []
  for (const r of rules) {
    const t = r.trim()
    // Drop `%`-bearing tokens: under the Windows .cmd path they'd throw in
    // quoteForCmd (cmd var-expansion can't be escaped inside verbatim args). No
    // legitimate rule/dir needs `%`, so fail-safe at validation (CRIT-1).
    if (t && !t.includes('%') && !out.includes(t)) out.push(t)
  }
  return out
}

/**
 * Whitelist the effort value before it reaches argv. Anything not in the known
 * set (including undefined/'') is dropped so the CLI falls back to its default —
 * keeps `--effort` from ever carrying an unvalidated token.
 */
export function toCliEffort(e?: string): Effort | undefined {
  return e && (EFFORT_LEVELS as readonly string[]).includes(e) ? (e as Effort) : undefined
}

/**
 * What a single stream-json line means. Extracting this from the stdout loop lets
 * the SAME interpretation run on the trailing partial line at `exit` — on an
 * abnormal CLI crash the final (e.g. `result`, which carries usage/cost) line can
 * arrive without a closing newline, and was silently dropped before (#3).
 */
export type LineAction =
  | { kind: 'stderr'; text: string }
  | { kind: 'permission'; req: ControlRequest }
  | { kind: 'drop' }
  | { kind: 'event'; event: unknown; isResult: boolean }

export function classifyLine(raw: string): LineAction | null {
  const line = raw.trim()
  if (!line) return null
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    // Malformed line → surface to the terminal log, never throw.
    return { kind: 'stderr', text: line }
  }
  // A tool needs permission → ask the renderer; do NOT forward as a normal event.
  const req = parseControlRequest(event)
  if (req) return { kind: 'permission', req }
  // The CLI's own control frames (initialize response, etc.) are protocol noise.
  if (isControlFrame(event)) return { kind: 'drop' }
  return { kind: 'event', event, isResult: isResultEvent(event) }
}

const turns = new Map<string, ChildProcess>()
/**
 * CRIT-2b: the exact tool input MAIN parsed from each `can_use_tool` request,
 * keyed turnId → (request id → original input). On `allow` we echo THIS back to
 * the CLI, never the renderer's `updatedInput`, so a compromised renderer can't
 * silently rewrite an approved tool call. Cleared per-id on response and per-turn
 * on exit so it can't leak across crashes/cancels.
 */
const pendingInput = new Map<string, Map<string, unknown>>()
let cachedBin: string | null | undefined // undefined = not probed, null = not found

/** Locate the claude binary once. Returns the resolved path, or null. */
export async function detectClaude(): Promise<string | null> {
  if (cachedBin !== undefined) return cachedBin
  cachedBin = await probe()
  return cachedBin
}

/** Windows-runnable forms: a real `.exe`, or a `.cmd`/`.bat` shim (run via cmd.exe). */
const WIN_RUNNABLE = /\.(exe|cmd|bat)$/i

/**
 * Pick the bin to spawn from `where`/`which` output (already existence-filtered).
 * On Windows, `where claude` lists the EXTENSIONLESS npm shim first — that file is
 * a Unix shell script CreateProcess can't execute (and, lacking a .cmd/.bat suffix,
 * isDirectExe would try to run it directly → `spawn …\npm\claude ENOENT`). So prefer
 * the first real `.exe`/`.cmd`/`.bat`, falling back to the first candidate elsewhere.
 */
export function pickClaudeBin(candidates: string[]): string | null {
  if (process.platform === 'win32') {
    const runnable = candidates.find((c) => WIN_RUNNABLE.test(c))
    if (runnable) return runnable
  }
  return candidates[0] ?? null
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
      const candidates = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter(existsSync)
      resolve(pickClaudeBin(candidates))
    })
  })
}

/**
 * Map a ClaudeDeck model id (the fixture/picker id, e.g. `opus-4-8`) to a value
 * the real `claude --model` flag accepts. The CLI takes short aliases
 * (`opus`/`sonnet`/`haiku`) or full ids (`claude-opus-4-8`) — NOT `opus-4-8`.
 * This is a WHITELIST: known fixture ids map via MODEL_ALIASES, the CLI's own
 * aliases/full ids pass through, EVERYTHING ELSE is dropped (→ undefined) so an
 * attacker-supplied token (e.g. `a&calc`) never reaches `--model`. Matches the
 * `toCliEffort` whitelist discipline (CRIT-1).
 */
const MODEL_ALIASES: Record<string, string> = {
  'opus-4-8': 'opus',
  'sonnet-4-6': 'sonnet',
  'haiku-4-5': 'haiku',
  'fable-5': 'claude-fable-5',
}
const CLI_MODELS = new Set(['opus', 'sonnet', 'haiku', 'claude-fable-5',
  'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'])
export function toCliModel(id?: string): string | undefined {
  if (!id) return undefined
  if (id in MODEL_ALIASES) return MODEL_ALIASES[id]
  return CLI_MODELS.has(id) ? id : undefined // unknown → drop (was: pass through)
}

/**
 * Whitelist the permission mode before it reaches `--permission-mode`. Anything
 * outside the known set (including an attacker token like `evil&x`) falls back to
 * `'default'` so argv never carries an unvalidated value (CRIT-1).
 */
const MODES: readonly PermissionMode[] = ['plan', 'acceptEdits', 'bypassPermissions', 'default', 'auto', 'dontAsk']
export function toCliMode(m?: string): PermissionMode {
  return (MODES as readonly string[]).includes(m ?? '') ? (m as PermissionMode) : 'default'
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
  const allow = cleanRules(a.allowedTools)
  const deny = cleanRules(a.disallowedTools)
  const dirs = cleanRules(a.additionalDirs)
  const settingsJson = buildSettingsJson(a.settings)
  // Reject `%`-bearing values (see cleanRules): they'd throw in quoteForCmd on the
  // Windows .cmd path. Drop the flag rather than crash the turn.
  const settingSources = a.settingSources && !a.settingSources.includes('%') ? a.settingSources : undefined
  const sessionId = a.sessionId && !a.sessionId.includes('%') ? a.sessionId : undefined
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', toCliMode(a.permissionMode),
    // Stream-json input + the stdio permission-prompt tool let the CLI delegate
    // tool-permission decisions back to us over the control protocol (Task 5.0).
    '--input-format', 'stream-json',
    '--permission-prompt-tool', 'stdio',
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    ...(allow.length ? ['--allowedTools', ...allow] : []),
    ...(deny.length ? ['--disallowedTools', ...deny] : []),
    ...(dirs.length ? ['--add-dir', ...dirs] : []),
    ...(settingsJson ? ['--settings', settingsJson] : []),
    // settingSources selects which config layers load — independent of defaultMode.
    ...(settingSources ? ['--setting-sources', settingSources] : []),
    ...(sessionId ? ['--resume', sessionId] : []),
    // Fork only makes sense when resuming: copy the parent transcript to a new id.
    ...(sessionId && a.forkSession ? ['--fork-session'] : []),
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
  // One safe spawn transport for both platforms: a real .exe runs directly
  // (shell:false); a .cmd shim goes through cmd.exe with verbatim args + per-token
  // quoting (spawnCli) so no metacharacter is ever reparsed by a shell (CRIT-1).
  const proc = spawnCli(bin, args, { cwd })

  turns.set(a.turnId, proc)

  // Control-protocol handshake (Task 5.0): initialize, then the prompt as a
  // stream-json user message — the prompt lives ONLY in the JSON content, never
  // on argv. stdin stays OPEN so we can write control_responses mid-turn; it is
  // ended when the `result` event arrives (the turn-completion signal) or on
  // cancel. A turn needing no permission still emits `result` and exits cleanly.
  proc.stdin?.write(buildInitialize() + '\n', 'utf8')
  proc.stdin?.write(buildUserMessage(a.prompt, a.images) + '\n', 'utf8')

  // Dispatch one interpreted line to the renderer (and close stdin on result).
  const apply = (action: LineAction | null): void => {
    if (!action) return
    switch (action.kind) {
      case 'stderr':
        safeSend(win, 'claude:stderr', { turnId: a.turnId, text: action.text })
        break
      case 'permission': {
        // Remember the input MAIN parsed BEFORE asking the renderer, so respondPermission
        // can echo it back on allow regardless of what the renderer sends (CRIT-2b).
        let m = pendingInput.get(a.turnId)
        if (!m) { m = new Map(); pendingInput.set(a.turnId, m) }
        m.set(action.req.id, action.req.input)
        safeSend(win, 'claude:permission-request', { turnId: a.turnId, ...action.req })
        break
      }
      case 'drop':
        break
      case 'event':
        safeSend(win, 'claude:event', { turnId: a.turnId, event: action.event })
        // Turn done: close stdin so the CLI shuts down cleanly.
        if (action.isResult) proc.stdin?.end()
        break
    }
  }

  let buf = ''
  proc.stdout?.on('data', (d) => {
    buf += String(d)
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      apply(classifyLine(line))
    }
  })
  proc.stderr?.on('data', (d) => safeSend(win,'claude:stderr', { turnId: a.turnId, text: String(d) }))
  proc.on('error', (e) => safeSend(win,'claude:stderr', { turnId: a.turnId, text: e.message }))
  proc.on('exit', (code) => {
    // Flush any trailing line the stream never newline-terminated. On an abnormal
    // exit the final result/usage line can lack its closing '\n' — process it the
    // same way so that turn's cost isn't lost (#3).
    if (buf.trim()) apply(classifyLine(buf))
    buf = ''
    turns.delete(a.turnId)
    pendingInput.delete(a.turnId) // prevent map leak on crash/cancel/normal exit
    safeSend(win,'claude:done', { turnId: a.turnId, code: code ?? -1 })
  })

  return { ok: true }
}

/**
 * Answer a pending can_use_tool request for a turn by writing a control_response
 * to its still-open stdin. On `allow` we echo the input MAIN parsed (pendingInput),
 * NOT the renderer's `opts.input` — a compromised renderer can't rewrite an
 * approved tool call (CRIT-2b). `opts.input` is only a fallback on a map miss
 * (race), preserving honest behaviour. `message` (deny) is the reason. Returns
 * false if the turn is gone / stdin shut.
 */
export function respondPermission(
  turnId: string,
  id: string,
  decision: PermissionDecision,
  opts?: { input?: unknown; message?: string },
): boolean {
  const proc = turns.get(turnId)
  if (!proc?.stdin || proc.stdin.writableEnded) return false
  const original = pendingInput.get(turnId)?.get(id)
  const safeOpts = decision === 'allow'
    ? { input: original ?? opts?.input ?? {} }
    : { message: opts?.message }
  proc.stdin.write(buildControlResponse(id, decision, safeOpts) + '\n', 'utf8')
  pendingInput.get(turnId)?.delete(id)
  return true
}

/** Kill the process tree for a turn (best-effort; exit fires claude:done). */
export function cancelTurn(turnId: string): void {
  const proc = turns.get(turnId)
  if (!proc?.pid) return
  proc.stdin?.end() // stop holding the control stream open
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
  else proc.kill('SIGTERM')
}

/** Kill every live turn (called on quit). */
export function cancelAllTurns(): void {
  for (const id of [...turns.keys()]) cancelTurn(id)
}
