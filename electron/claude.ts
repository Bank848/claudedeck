import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { BrowserWindow } from 'electron'

export type PermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default'

export interface StartTurnArgs {
  turnId: string
  prompt: string
  cwd: string
  sessionId?: string
  model?: string
  permissionMode: PermissionMode
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

function buildArgs(a: StartTurnArgs): string[] {
  return [
    '-p', a.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', a.permissionMode,
    ...(a.model ? ['--model', a.model] : []),
    ...(a.sessionId ? ['--resume', a.sessionId] : []),
  ]
}

/**
 * Spawn one turn. The prompt is passed as a discrete argv element (never string-
 * concatenated), so there is no shell injection even though .cmd on Windows is
 * launched via `cmd.exe /c` (Node quotes each argument).
 */
export async function startTurn(win: BrowserWindow, a: StartTurnArgs): Promise<{ ok: boolean; error?: string }> {
  const bin = await detectClaude()
  if (!bin) return { ok: false, error: 'claude CLI not found' }
  if (a.cwd && !existsSync(a.cwd)) return { ok: false, error: `cwd does not exist: ${a.cwd}` }

  const args = buildArgs(a)
  const isWin = process.platform === 'win32'
  const proc = isWin
    ? spawn('cmd.exe', ['/c', bin, ...args], { cwd: a.cwd, windowsHide: true })
    : spawn(bin, args, { cwd: a.cwd })

  turns.set(a.turnId, proc)

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
        win.webContents.send('claude:event', { turnId: a.turnId, event })
      } catch {
        // Malformed line → surface to the terminal log, never throw.
        win.webContents.send('claude:stderr', { turnId: a.turnId, text: line })
      }
    }
  })
  proc.stderr?.on('data', (d) => win.webContents.send('claude:stderr', { turnId: a.turnId, text: String(d) }))
  proc.on('error', (e) => win.webContents.send('claude:stderr', { turnId: a.turnId, text: e.message }))
  proc.on('exit', (code) => {
    turns.delete(a.turnId)
    win.webContents.send('claude:done', { turnId: a.turnId, code: code ?? -1 })
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
