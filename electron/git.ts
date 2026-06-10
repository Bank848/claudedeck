import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
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

/**
 * A worktree path must be non-empty and must not start with `-` (else git would
 * parse it as an option). Paths legitimately contain spaces/`~`/etc., so unlike
 * `isValidRef` this only guards the leading-dash/empty cases (MEDIUM). We do NOT
 * add a `--` separator: `git worktree add` has no such separator and `git checkout
 * -- main` would treat `main` as a pathspec, breaking branch switching.
 */
export function isSafePath(p: string): boolean {
  const t = p.trim()
  return t.length > 0 && !t.startsWith('-')
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
  if (!isSafePath(wtPath)) return { ok: false, error: 'invalid path' }
  const args = newBranch
    ? ['worktree', 'add', '-b', branch, wtPath]
    : ['worktree', 'add', wtPath, branch]
  const r = await runGit(cwd, args)
  return r.code === 0
    ? { ok: true, path: wtPath }
    : { ok: false, error: r.stderr.trim() || `git exited ${r.code}` }
}

/**
 * Sibling worktree dir for a fork: <parent-of-root>/<root-basename>-worktrees/<branch-slug>.
 * Pure (no FS). Branch slashes collapse to dashes so the leaf is one dir level.
 * e.g. forkWorktreePath('/code/ClaudeDeck', 'fork/fix-auth')
 *        → '/code/ClaudeDeck-worktrees/fork-fix-auth'
 */
export function forkWorktreePath(repoRoot: string, branch: string): string {
  const root = repoRoot.replace(/[/\\]+$/, '')
  const parent = dirname(root)
  const name = basename(root)
  const leaf = branch.replace(/\//g, '-')
  return join(parent, `${name}-worktrees`, leaf)
}

/**
 * Fork the repo at `cwd` onto a brand-new `branch` in a fresh sibling worktree.
 * Resolves the repo's top-level first so it works from any subdir or linked worktree.
 */
export async function gitForkWorktree(
  cwd: string,
  branch: string,
): Promise<{ ok: boolean; path?: string; branch?: string; error?: string }> {
  if (!isValidRef(branch)) return { ok: false, error: 'invalid branch name' }
  const top = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (top.code !== 0) return { ok: false, error: top.stderr.trim() || 'not a git repo' }
  const root = top.stdout.split('\n')[0]?.trim() ?? ''
  if (!root) return { ok: false, error: 'could not resolve repo root' }
  const wtPath = forkWorktreePath(root, branch)
  const r = await gitWorktreeAdd(root, wtPath, branch, true)
  return r.ok ? { ok: true, path: r.path, branch } : { ok: false, error: r.error }
}
