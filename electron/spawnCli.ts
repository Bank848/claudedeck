import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

const CMD_SHIM = /\.(cmd|bat)$/i

/** True when the resolved bin is directly executable by CreateProcess (no shell). */
export function isDirectExe(bin: string): boolean {
  return process.platform !== 'win32' || !CMD_SHIM.test(bin)
}

/** Quote one argv token for `cmd.exe` with windowsVerbatimArguments.
 *  Inside double quotes cmd suppresses & | < > ^ ( ). `%` (var-expansion) CANNOT
 *  be reliably escaped inside quotes under verbatim args, so callers MUST reject
 *  `%` upstream (T3) — quoteForCmd asserts it never receives one. */
export function quoteForCmd(arg: string): string {
  if (arg.includes('%')) throw new Error('refusing to quote a token containing %')
  // Backslashes that precede a quote (or the closing quote) must be doubled
  // per CommandLineToArgvW so the child re-parses the original token exactly.
  const s = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  return `"${s}"`
}

/** Spawn a resolved CLI binary safely on every platform. */
export function spawnCli(bin: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  if (isDirectExe(bin)) return spawn(bin, args, { windowsHide: true, ...opts })
  // Each token is individually quoted, then the WHOLE line is wrapped in one more
  // quote pair. `cmd /s` strips exactly the first and last char of its command line
  // when both are quotes — without the outer pair it would strip the bin's own
  // quotes (`"claude.cmd" "auth"…` → `claude.cmd" "auth"…` → "not recognized").
  // The outer pair absorbs that strip so the inner per-token quoting survives intact.
  const line = [bin, ...args].map(quoteForCmd).join(' ')
  return spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    windowsHide: true, windowsVerbatimArguments: true, ...opts,
  })
}
