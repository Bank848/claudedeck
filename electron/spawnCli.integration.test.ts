import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnCli } from './spawnCli'

/**
 * Regression for the `cmd /s` outer-quote bug: spawning a `.cmd` shim with quoted
 * tokens used to feed cmd.exe `"bin" "arg"…`, and `/s` stripped the bin's own
 * leading/trailing quote → `bin" "arg…` → "is not recognized" → exit 1 (the login
 * failure). The whole line must be wrapped in one extra quote pair so `/s` strips
 * THAT instead. This runs only on win32, where the cmd.exe branch exists.
 */
const runWin = process.platform === 'win32'

describe.runIf(runWin)('spawnCli — .cmd shim launches through cmd.exe (outer-quote regression)', () => {
  let dir: string
  let echoCmd: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'spawncli-'))
    echoCmd = join(dir, 'echo-args.cmd')
    // Prints each %* arg on its own line so we can assert exact token boundaries.
    writeFileSync(echoCmd, '@echo off\r\n:loop\r\nif "%~1"=="" goto end\r\necho ARG=%~1\r\nshift\r\ngoto loop\r\n:end\r\n')
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('passes multiple tokens through intact (exit 0, no "not recognized")', async () => {
    const { code, out } = await collect(echoCmd, ['auth', 'login', '--claudeai'])
    expect(out).not.toMatch(/is not recognized/i)
    expect(code).toBe(0)
    expect(out).toContain('ARG=auth')
    expect(out).toContain('ARG=login')
    expect(out).toContain('ARG=--claudeai')
  })

  it('keeps a token containing spaces as ONE argument (not split into many)', async () => {
    // A space-bearing path is the realistic case (e.g. cwd "D:\Claudec Code CLI App").
    // If the outer quoting were wrong it would arrive as three args, not one.
    const { out } = await collect(echoCmd, ['one two three'])
    expect(out).toContain('ARG=one two three')
    // Splitting would surface the later words as their own ARG= lines.
    expect(out).not.toMatch(/ARG=two/)
    expect(out).not.toMatch(/ARG=three/)
  })
})

function collect(bin: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawnCli(bin, args)
    let out = ''
    p.stdout?.on('data', (d) => (out += String(d)))
    p.stderr?.on('data', (d) => (out += String(d)))
    p.on('exit', (code) => resolve({ code, out }))
  })
}
