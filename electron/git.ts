import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pickCwd } from './claude'

export interface GitStatus {
  isRepo: boolean
  branch: string
  isWorktree: boolean
  isDirty: boolean
}
export interface Worktree {
  path: string
  branch: string
}
export interface GitResult {
  ok: boolean
  error?: string
}

// ── pure helpers (unit-tested) ───────────────────────────────────────────────

/** First line of `git rev-parse --abbrev-ref HEAD`; 'HEAD' means detached. */
export function parseBranch(revParseOut: string): string {
  return revParseOut.split('\n')[0]?.trim() ?? ''
}

/** `git branch --format=%(refname:short)` → trimmed, non-empty lines. */
export function parseBranches(out: string): string[] {
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/**
 * Build GitStatus from rev-parse output (line 1 = branch, line 2 = absolute git
 * dir) and porcelain output (non-empty ⇒ dirty). A linked worktree's git dir
 * contains a `/worktrees/` segment.
 */
export function parseStatus(revParseOut: string, porcelainOut: string): Omit<GitStatus, 'isRepo'> {
  const lines = revParseOut.split('\n').map((l) => l.trim())
  const branch = lines[0] ?? ''
  const gitDir = lines[1] ?? ''
  return {
    branch,
    isWorktree: gitDir.replace(/\\/g, '/').includes('/worktrees/'),
    isDirty: porcelainOut.trim().length > 0,
  }
}

/** Parse `git worktree list --porcelain` into {path, branch} blocks. */
export function parseWorktrees(out: string): Worktree[] {
  const result: Worktree[] = []
  let path = ''
  let branch = ''
  const flush = (): void => {
    if (path) result.push({ path, branch: branch || '(detached)' })
    path = ''
    branch = ''
  }
  for (const raw of out.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length)
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
  }
  flush()
  return result
}

/** Reject names that could be flags or shell-dangerous (defense in depth; args are not shelled). */
export function isValidRef(name: string): boolean {
  return /^[^\s-][^\s~^:?*[\\]*$/.test(name) && !name.includes('..')
}

// ── spawn runner ─────────────────────────────────────────────────────────────

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function runGit(cwd: string, args: string[]): Promise<RunResult> {
  const dir = pickCwd(cwd, process.cwd(), existsSync)
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd: dir, windowsHide: true })
    let stdout = ''
    let stderr = ''
    p.stdout?.on('data', (d) => (stdout += String(d)))
    p.stderr?.on('data', (d) => (stderr += String(d)))
    p.on('error', (e) => resolve({ code: -1, stdout, stderr: e.message }))
    p.on('exit', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

// ── runners (used by IPC) ────────────────────────────────────────────────────

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const rev = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD', '--absolute-git-dir'])
  if (rev.code !== 0) return { isRepo: false, branch: '', isWorktree: false, isDirty: false }
  const porc = await runGit(cwd, ['status', '--porcelain'])
  return { isRepo: true, ...parseStatus(rev.stdout, porc.stdout) }
}

export async function gitBranches(cwd: string): Promise<string[]> {
  const r = await runGit(cwd, ['branch', '--format=%(refname:short)'])
  return r.code === 0 ? parseBranches(r.stdout) : []
}

export async function gitCheckout(cwd: string, branch: string): Promise<GitResult> {
  if (!isValidRef(branch)) return { ok: false, error: 'invalid branch name' }
  const r = await runGit(cwd, ['checkout', branch])
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || `git exited ${r.code}` }
}

export async function gitWorktrees(cwd: string): Promise<Worktree[]> {
  const r = await runGit(cwd, ['worktree', 'list', '--porcelain'])
  return r.code === 0 ? parseWorktrees(r.stdout) : []
}

export async function gitWorktreeAdd(
  cwd: string,
  wtPath: string,
  branch: string,
  newBranch?: boolean,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!isValidRef(branch)) return { ok: false, error: 'invalid branch name' }
  if (!wtPath.trim()) return { ok: false, error: 'no path given' }
  const args = newBranch
    ? ['worktree', 'add', '-b', branch, wtPath]
    : ['worktree', 'add', wtPath, branch]
  const r = await runGit(cwd, args)
  return r.code === 0
    ? { ok: true, path: wtPath }
    : { ok: false, error: r.stderr.trim() || `git exited ${r.code}` }
}
