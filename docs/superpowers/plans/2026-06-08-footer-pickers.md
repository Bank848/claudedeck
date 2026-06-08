# Footer Pickers — Folder · Branch · Worktree

**Approved design (chat, 2026-06-08).** Replace the StatusBar left group (Ready dot +
mislabeled `GitBranch`-basename) and drop the duplicate full-cwd span on the right with a
Claude-Code-app-style footer picker cluster: `● Ready  [📁 folder]  [⌥ branch ☐wt] [📂+]`.
Only real capabilities — **no stubs**. Environment/Cloud/SSH dropped entirely (only Local is
possible, nothing to pick). Folder + Branch + Worktree are all real.

Per global CLAUDE.md this skips a standalone spec.md (already brainstormed, medium feature).

## Goal

- **FolderPicker**: chip shows current folder name; popover lists Recent folders (localStorage
  `claudedeck.recentFolders`, deduped, newest-first, cap 12, current ✓) + "Open folder…"
  (existing `pickDirectory` IPC). Selecting dispatches the existing `setCwd` reducer action and
  records the recent.
- **BranchPicker**: chip shows current git branch; popover shows current branch (✓), a
  "Search branches…" filter, and the filtered branch list. Selecting runs `git checkout`.
  Success → chip updates + aria-live announce; failure (dirty tree) → error announced, chip
  unchanged.
- **WorktreeButton**: a ☐/☑ indicator (is the current cwd a linked worktree?) plus a `📂+`
  button that creates a worktree (`git worktree add`) for a chosen/new branch under a chosen
  parent dir, then switches cwd to it.
- **Feedback**: apply immediately (no modal); chip label updates; `aria-live` announces the
  change (blind-UX requirement); git failures are surfaced, never silent.

## Architecture

```
renderer                                    main (electron)
─────────────────────────────────────────  ──────────────────────────────
FooterPickers (layout/, in StatusBar)       electron/git.ts
  ├─ FolderPicker  ── system/recentFolders    pure: parseBranch, parseStatus,
  ├─ BranchPicker  ┐                                parseWorktrees, isValidRef
  └─ WorktreeButton┴─ useGit(cwd) ─ gitClient   runGit(cwd,args) spawn (no shell)
                                                 gitStatus/gitBranches/gitCheckout/
StatusBar  ── props: cwd, onSetCwd, onAnnounce   gitWorktrees/gitWorktreeAdd
App        ── onSetCwd dispatch, onAnnounce=setLiveStatus
                                              main.ts  ipcMain.handle('git:*')
                                              preload.ts  window.claudedeck.git.*
```

Mirrors the existing `claude.ts`/`auth.ts` pattern: pure helpers (unit-tested) + thin spawn
runners + `ipcMain.handle` + preload surface + renderer client. `git` is a real `git.exe` on
PATH, so `spawn('git', args, { cwd, windowsHide: true })` is used directly (no `cmd.exe`
wrapper — that wrapper exists in claude/auth only because the npm `claude.cmd` shim needs it).

## Tech Stack / conventions

- TS strict; immutable updates; functions <50 lines; pure helpers tested with vitest.
- Reuse `components/Pill.tsx` (`Pill`, `Popover`, `usePopover`, `nextRovingIndex`).
- Token classes only (`bg-surface/surface-2`, `text-fg/fg-muted`, `text-accent`, `border-border`).
- Gate before done: `npm run typecheck && npm test && npm run build` all green.

## File Structure

```
electron/
  git.ts            NEW  pure parsers + runGit + 5 runners
  git.test.ts       NEW  parser unit tests
  main.ts           EDIT register git:* IPC
  preload.ts        EDIT add window.claudedeck.git surface
src/renderer/
  system/
    recentFolders.ts       NEW  pure load/add/save (localStorage)
    recentFolders.test.ts  NEW
  cli/
    gitClient.ts     NEW  wraps window.claudedeck.git
    useGit.ts        NEW  hook: status/branches/worktrees + actions
  components/controls/
    FolderPicker.tsx   NEW
    BranchPicker.tsx   NEW
    WorktreeButton.tsx NEW
  layout/
    FooterPickers.tsx  NEW  composes the three
    StatusBar.tsx      EDIT host FooterPickers, drop old cwd spans
  App.tsx            EDIT pass onSetCwd + onAnnounce to StatusBar
```

---

## Task 1 — `electron/git.ts`: pure parsers + spawn runners

Create `electron/git.ts`:

```ts
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
```

Create `electron/git.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseBranch, parseBranches, parseStatus, parseWorktrees, isValidRef } from './git'

describe('parseBranch', () => {
  it('returns first trimmed line', () => {
    expect(parseBranch('main\n')).toBe('main')
  })
  it('returns HEAD when detached', () => {
    expect(parseBranch('HEAD\nC:/repo/.git\n')).toBe('HEAD')
  })
})

describe('parseBranches', () => {
  it('splits and drops blanks', () => {
    expect(parseBranches('main\nfeature\n\n  dev  \n')).toEqual(['main', 'feature', 'dev'])
  })
  it('empty input → []', () => {
    expect(parseBranches('')).toEqual([])
  })
})

describe('parseStatus', () => {
  it('clean main, not a worktree', () => {
    expect(parseStatus('main\nC:/repo/.git', '')).toEqual({
      branch: 'main',
      isWorktree: false,
      isDirty: false,
    })
  })
  it('dirty + linked worktree (windows path)', () => {
    expect(parseStatus('feat\nC:\\repo\\.git\\worktrees\\feat', ' M file.ts\n')).toEqual({
      branch: 'feat',
      isWorktree: true,
      isDirty: true,
    })
  })
})

describe('parseWorktrees', () => {
  it('parses porcelain blocks incl. detached', () => {
    const out = [
      'worktree /repo',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree /repo/.wt/feat',
      'HEAD def',
      'branch refs/heads/feat',
      '',
      'worktree /repo/.wt/dt',
      'HEAD 111',
      'detached',
      '',
    ].join('\n')
    expect(parseWorktrees(out)).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/repo/.wt/feat', branch: 'feat' },
      { path: '/repo/.wt/dt', branch: '(detached)' },
    ])
  })
})

describe('isValidRef', () => {
  it('accepts normal names', () => {
    expect(isValidRef('main')).toBe(true)
    expect(isValidRef('feature/x_1')).toBe(true)
  })
  it('rejects flags, spaces, traversal, refspec chars', () => {
    expect(isValidRef('-rf')).toBe(false)
    expect(isValidRef('a b')).toBe(false)
    expect(isValidRef('a..b')).toBe(false)
    expect(isValidRef('a~1')).toBe(false)
  })
})
```

- [ ] Write `electron/git.ts` and `electron/git.test.ts`
- [ ] `npm test -- git` → 5 describe blocks green

---

## Task 2 — `main.ts`: register `git:*` IPC

In `electron/main.ts`, add the import near the other electron-side imports (top of file,
alongside the `./auth` / `./claude` imports — find the existing `import { ... } from './auth'`):

```ts
import { gitStatus, gitBranches, gitCheckout, gitWorktrees, gitWorktreeAdd } from './git'
```

Then register handlers next to the `auth:*` block (after line `ipcMain.handle('auth:logout', () => logout())`):

```ts
  // ── git (footer pickers) ──────────────────────────────────────────────────
  ipcMain.handle('git:status', (_e, cwd: string) => gitStatus(cwd))
  ipcMain.handle('git:branches', (_e, cwd: string) => gitBranches(cwd))
  ipcMain.handle('git:checkout', (_e, args: { cwd: string; branch: string }) =>
    gitCheckout(args.cwd, args.branch),
  )
  ipcMain.handle('git:worktrees', (_e, cwd: string) => gitWorktrees(cwd))
  ipcMain.handle(
    'git:worktree-add',
    (_e, args: { cwd: string; path: string; branch: string; newBranch?: boolean }) =>
      gitWorktreeAdd(args.cwd, args.path, args.branch, args.newBranch),
  )
```

- [ ] Edit `electron/main.ts`
- [ ] `npm run typecheck` green

---

## Task 3 — `preload.ts`: `window.claudedeck.git` surface

In `electron/preload.ts`, add inside the `api` object after the `auth: { … }` block, importing
the types at the top (`import type { GitStatus, Worktree, GitResult } from './git'`):

```ts
  /** Git footer pickers — runs in the active session cwd. */
  git: {
    status: (cwd: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', cwd),
    branches: (cwd: string): Promise<string[]> => ipcRenderer.invoke('git:branches', cwd),
    checkout: (cwd: string, branch: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:checkout', { cwd, branch }),
    worktrees: (cwd: string): Promise<Worktree[]> => ipcRenderer.invoke('git:worktrees', cwd),
    worktreeAdd: (
      args: { cwd: string; path: string; branch: string; newBranch?: boolean },
    ): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('git:worktree-add', args),
  },
```

`ClaudeDeckApi = typeof api` already re-exports the new surface automatically.

- [ ] Edit `electron/preload.ts`
- [ ] `npm run typecheck` green

---

## Task 4 — `system/recentFolders.ts` (pure) + test

Create `src/renderer/system/recentFolders.ts`:

```ts
const KEY = 'claudedeck.recentFolders'
const CAP = 12

/** Pure: prepend `path`, dedupe (case-sensitive exact), drop blanks, cap length. */
export function addRecent(list: string[], path: string): string[] {
  const p = path.trim()
  if (!p) return list
  return [p, ...list.filter((x) => x !== p)].slice(0, CAP)
}

export function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, CAP) : []
  } catch {
    return []
  }
}

export function recordRecent(path: string): string[] {
  const next = addRecent(loadRecents(), path)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore quota errors */
  }
  return next
}

/** Display label: last path segment (handles both / and \\), fallback to full. */
export function folderLabel(path: string): string {
  if (!path) return 'No folder'
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || path
}
```

Create `src/renderer/system/recentFolders.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { addRecent, folderLabel } from './recentFolders'

describe('addRecent', () => {
  it('prepends new path', () => {
    expect(addRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })
  it('moves existing to front (dedupe)', () => {
    expect(addRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })
  it('ignores blank', () => {
    expect(addRecent(['a'], '  ')).toEqual(['a'])
  })
  it('caps at 12', () => {
    const many = Array.from({ length: 12 }, (_, i) => `d${i}`)
    expect(addRecent(many, 'new')).toHaveLength(12)
    expect(addRecent(many, 'new')[0]).toBe('new')
  })
})

describe('folderLabel', () => {
  it('last segment, windows', () => {
    expect(folderLabel('D:\\Claudec Code CLI App')).toBe('Claudec Code CLI App')
  })
  it('last segment, posix + trailing slash', () => {
    expect(folderLabel('/home/me/proj/')).toBe('proj')
  })
  it('empty → No folder', () => {
    expect(folderLabel('')).toBe('No folder')
  })
})
```

- [ ] Write both files
- [ ] `npm test -- recentFolders` green

---

## Task 5 — `cli/gitClient.ts` + `cli/useGit.ts`

Create `src/renderer/cli/gitClient.ts` (browser-preview-safe: guard `window.claudedeck`):

```ts
import type { GitStatus, Worktree } from '../../../electron/git'

// Mirror claudeClient.ts/authClient.ts: `claudedeck` is typed present but is
// ABSENT at runtime in the vite browser preview, so guard `typeof window`.
const git = (): ClaudeDeckGit | undefined =>
  typeof window !== 'undefined' ? window.claudedeck?.git : undefined
type ClaudeDeckGit = NonNullable<Window['claudedeck']>['git']

const NO_REPO: GitStatus = { isRepo: false, branch: '', isWorktree: false, isDirty: false }

export const gitClient = {
  status: (cwd: string): Promise<GitStatus> => git()?.status(cwd) ?? Promise.resolve(NO_REPO),
  branches: (cwd: string): Promise<string[]> => git()?.branches(cwd) ?? Promise.resolve([]),
  checkout: (cwd: string, branch: string): Promise<{ ok: boolean; error?: string }> =>
    git()?.checkout(cwd, branch) ?? Promise.resolve({ ok: false, error: 'unavailable' }),
  worktrees: (cwd: string): Promise<Worktree[]> => git()?.worktrees(cwd) ?? Promise.resolve([]),
  worktreeAdd: (
    args: { cwd: string; path: string; branch: string; newBranch?: boolean },
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    git()?.worktreeAdd(args) ?? Promise.resolve({ ok: false, error: 'unavailable' }),
}
```

Create `src/renderer/cli/useGit.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { gitClient } from './gitClient'
import type { GitStatus, Worktree } from '../../../electron/git'

const NO_REPO: GitStatus = { isRepo: false, branch: '', isWorktree: false, isDirty: false }

export interface UseGit {
  status: GitStatus
  branches: string[]
  worktrees: Worktree[]
  refresh: () => void
  checkout: (branch: string) => Promise<{ ok: boolean; error?: string }>
  addWorktree: (path: string, branch: string, newBranch?: boolean) => Promise<{ ok: boolean; error?: string }>
}

/** Loads git state for `cwd`; reloads whenever cwd changes or after a mutation. */
export function useGit(cwd: string): UseGit {
  const [status, setStatus] = useState<GitStatus>(NO_REPO)
  const [branches, setBranches] = useState<string[]>([])
  const [worktrees, setWorktrees] = useState<Worktree[]>([])

  const load = useCallback(() => {
    let live = true
    void gitClient.status(cwd).then((s) => {
      if (!live) return
      setStatus(s)
      if (s.isRepo) {
        void gitClient.branches(cwd).then((b) => live && setBranches(b))
        void gitClient.worktrees(cwd).then((w) => live && setWorktrees(w))
      } else {
        setBranches([])
        setWorktrees([])
      }
    })
    return () => {
      live = false
    }
  }, [cwd])

  useEffect(() => load(), [load])

  const checkout = useCallback(
    async (branch: string) => {
      const r = await gitClient.checkout(cwd, branch)
      if (r.ok) load()
      return r
    },
    [cwd, load],
  )

  const addWorktree = useCallback(
    async (path: string, branch: string, newBranch?: boolean) => {
      const r = await gitClient.worktreeAdd({ cwd, path, branch, newBranch })
      if (r.ok) load()
      return r
    },
    [cwd, load],
  )

  return { status, branches, worktrees, refresh: load, checkout, addWorktree }
}
```

- [ ] Write both files
- [ ] `npm run typecheck` green

---

## Task 6 — `controls/FolderPicker.tsx`

Create `src/renderer/components/controls/FolderPicker.tsx`:

```tsx
import { useRef, useState } from 'react'
import { Folder, FolderPlus, Check } from 'lucide-react'
import { Pill, Popover, usePopover } from '../Pill'
import { pickDirectory } from '@/system/pickDirectory'
import { loadRecents, recordRecent, folderLabel } from '@/system/recentFolders'

interface FolderPickerProps {
  cwd: string
  onPick: (path: string) => void
  onAnnounce: (msg: string) => void
}

export function FolderPicker({ cwd, onPick, onAnnounce }: FolderPickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [recents, setRecents] = useState<string[]>(() => loadRecents())
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)

  const choose = (path: string): void => {
    if (path && path !== cwd) {
      setRecents(recordRecent(path))
      onPick(path)
      onAnnounce(`เปลี่ยนโฟลเดอร์เป็น ${folderLabel(path)}`)
    }
    setOpen(false)
    triggerRef.current?.focus()
  }
  const openNative = async (): Promise<void> => {
    const path = await pickDirectory()
    if (path) choose(path)
    else {
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Pill
        ref={triggerRef}
        icon={<Folder size={12} />}
        label={folderLabel(cwd)}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        ariaLabel="Choose working folder"
        haspopup="menu"
      />
      {open && (
        <Popover role="menu" ariaLabel="Recent folders" width="w-72">
          <div className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wide text-fg-muted">Recent</div>
          <ul className="max-h-72 overflow-y-auto py-1 text-sm">
            {recents.length === 0 && (
              <li className="px-3 py-1.5 text-fg-muted">No recent folders</li>
            )}
            {recents.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => choose(p)}
                  title={p}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg hover:bg-surface-2"
                >
                  <span className="flex-1 truncate">{folderLabel(p)}</span>
                  {p === cwd && <Check size={13} className="text-accent" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void openNative()}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-2"
          >
            <FolderPlus size={14} className="text-fg-muted" />
            Open folder…
          </button>
        </Popover>
      )}
    </div>
  )
}
```

- [ ] Write the file
- [ ] `npm run typecheck` green

---

## Task 7 — `controls/BranchPicker.tsx`

Create `src/renderer/components/controls/BranchPicker.tsx`:

```tsx
import { useRef, useState } from 'react'
import { GitBranch, Check } from 'lucide-react'
import { Pill, Popover, usePopover } from '../Pill'

interface BranchPickerProps {
  branch: string
  branches: string[]
  isWorktree: boolean
  onCheckout: (branch: string) => Promise<{ ok: boolean; error?: string }>
  onAnnounce: (msg: string) => void
}

export function BranchPicker({
  branch, branches, isWorktree, onCheckout, onAnnounce,
}: BranchPickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)

  if (!branch) return <></> // not a git repo → render nothing

  const filtered = branches.filter((b) => b.toLowerCase().includes(query.toLowerCase()))

  const select = async (b: string): Promise<void> => {
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
    if (b === branch) return
    const r = await onCheckout(b)
    onAnnounce(r.ok ? `สลับไป branch ${b}` : `สลับ branch ไม่สำเร็จ: ${r.error ?? 'error'}`)
  }

  return (
    <div className="relative flex items-center gap-1.5" ref={wrapRef}>
      <Pill
        ref={triggerRef}
        icon={<GitBranch size={12} />}
        label={branch}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        ariaLabel="Switch git branch"
        haspopup="listbox"
      />
      {isWorktree && (
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted" title="This folder is a git worktree">
          worktree
        </span>
      )}
      {open && (
        <Popover role="listbox" ariaLabel="Branches" width="w-64">
          <div className="p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search branches…"
              className="w-full rounded border border-border bg-surface-2 px-2 py-1 text-sm text-fg outline-none focus:border-accent"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1 text-sm">
            {filtered.length === 0 && <li className="px-3 py-1.5 text-fg-muted">No branches</li>}
            {filtered.map((b) => (
              <li key={b}>
                <button
                  type="button"
                  role="option"
                  aria-selected={b === branch}
                  onClick={() => void select(b)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg hover:bg-surface-2"
                >
                  <span className="flex-1 truncate">{b}</span>
                  {b === branch && <Check size={13} className="text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  )
}
```

- [ ] Write the file
- [ ] `npm run typecheck` green

---

## Task 8 — `controls/WorktreeButton.tsx`

A `📂+` pill that opens a small dialog popover: enter a branch (toggle "new branch") and pick a
parent folder via the native dir picker; on confirm, runs `git worktree add` then switches cwd.

Create `src/renderer/components/controls/WorktreeButton.tsx`:

```tsx
import { useRef, useState } from 'react'
import { FolderGit2 } from 'lucide-react'
import { Popover, usePopover } from '../Pill'
import { pickDirectory } from '@/system/pickDirectory'

interface WorktreeButtonProps {
  disabled: boolean // not a git repo
  onAdd: (path: string, branch: string, newBranch: boolean) => Promise<{ ok: boolean; error?: string }>
  onCreated: (path: string) => void
  onAnnounce: (msg: string) => void
}

export function WorktreeButton({ disabled, onAdd, onCreated, onAnnounce }: WorktreeButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState('')
  const [parent, setParent] = useState('')
  const [newBranch, setNewBranch] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)

  const choosePath = async (): Promise<void> => {
    const p = await pickDirectory()
    if (p) setParent(p)
  }
  const submit = async (): Promise<void> => {
    if (!branch.trim() || !parent.trim()) {
      setError('branch and folder required')
      return
    }
    const sep = parent.includes('\\') ? '\\' : '/'
    const path = `${parent.replace(/[/\\]+$/, '')}${sep}${branch.trim()}`
    setBusy(true)
    setError('')
    const r = await onAdd(path, branch.trim(), newBranch)
    setBusy(false)
    if (r.ok) {
      onCreated(path)
      onAnnounce(`สร้าง worktree ${branch.trim()} แล้ว`)
      setOpen(false)
      setBranch('')
      setParent('')
    } else {
      setError(r.error ?? 'failed')
      onAnnounce(`สร้าง worktree ไม่สำเร็จ: ${r.error ?? 'error'}`)
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="Create git worktree"
        title={disabled ? 'Not a git repository' : 'Create git worktree'}
        className={`flex items-center rounded-full border border-border bg-surface p-1 text-fg-muted transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          disabled ? 'cursor-not-allowed opacity-50' : ''
        }`}
      >
        <FolderGit2 size={13} />
      </button>
      {open && !disabled && (
        <Popover role="dialog" ariaLabel="Create worktree" width="w-72">
          <div className="space-y-2 p-3 text-sm">
            <label className="block">
              <span className="text-fg-muted">Branch</span>
              <input
                autoFocus
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="feature/x"
                className="mt-1 w-full rounded border border-border bg-surface-2 px-2 py-1 text-fg outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center gap-2 text-fg-muted">
              <input type="checkbox" checked={newBranch} onChange={(e) => setNewBranch(e.target.checked)} />
              Create new branch
            </label>
            <button
              type="button"
              onClick={() => void choosePath()}
              className="w-full truncate rounded border border-border bg-surface-2 px-2 py-1 text-left text-fg hover:bg-surface"
              title={parent}
            >
              {parent || 'Choose parent folder…'}
            </button>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="w-full rounded bg-accent/20 px-2 py-1 font-medium text-accent hover:bg-accent/30 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create worktree'}
            </button>
          </div>
        </Popover>
      )}
    </div>
  )
}
```

- [ ] Write the file
- [ ] `npm run typecheck` green

---

## Task 9 — `layout/FooterPickers.tsx`

Create `src/renderer/layout/FooterPickers.tsx` — owns `useGit`, wires the three controls:

```tsx
import { FolderPicker } from '@/components/controls/FolderPicker'
import { BranchPicker } from '@/components/controls/BranchPicker'
import { WorktreeButton } from '@/components/controls/WorktreeButton'
import { useGit } from '@/cli/useGit'

interface FooterPickersProps {
  cwd: string
  onSetCwd: (path: string) => void
  onAnnounce: (msg: string) => void
}

export function FooterPickers({ cwd, onSetCwd, onAnnounce }: FooterPickersProps): JSX.Element {
  const git = useGit(cwd)
  return (
    <div className="flex items-center gap-2">
      <FolderPicker cwd={cwd} onPick={onSetCwd} onAnnounce={onAnnounce} />
      <BranchPicker
        branch={git.status.branch}
        branches={git.branches}
        isWorktree={git.status.isWorktree}
        onCheckout={git.checkout}
        onAnnounce={onAnnounce}
      />
      <WorktreeButton
        disabled={!git.status.isRepo}
        onAdd={git.addWorktree}
        onCreated={onSetCwd}
        onAnnounce={onAnnounce}
      />
    </div>
  )
}
```

- [ ] Write the file
- [ ] `npm run typecheck` green

---

## Task 10 — Wire into `StatusBar.tsx` + `App.tsx`

**StatusBar.tsx** — replace the left group (the `Ready` span keeps, drop the `GitBranch`
+ basename span) and the right-side duplicate full-cwd span; host `FooterPickers`.

Replace the current left `<div className="flex items-center gap-4">…</div>` (lines 30–39) with:

```tsx
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Dot size={18} className={ready ? 'text-success' : 'text-destructive'} strokeWidth={6} />
          {ready ? 'Ready' : 'Error'}
        </span>
        <FooterPickers session={session} onSetCwd={onSetCwd} onAnnounce={onAnnounce} />
      </div>
```

Wait — `FooterPickers` takes `cwd`, not `session`. Use:

```tsx
        <FooterPickers cwd={session.cwd} onSetCwd={onSetCwd} onAnnounce={onAnnounce} />
```

In the right group, **delete** the `<span>` showing `<FolderOpen/> {session.cwd}` (lines 61–64);
keep model + tokens + Connect chip + permission mirror.

Update imports: drop `GitBranch` and `FolderOpen` if now unused (keep `Cpu`, `Coins`, `Dot`);
add `import { FooterPickers } from './FooterPickers'`.

Extend `StatusBarProps`:

```ts
interface StatusBarProps {
  session: Session
  loggedIn: boolean
  cliAvailable: boolean
  permissionMode: PermissionMode
  onConnect: () => void
  onDisconnect: () => void
  onSetCwd: (path: string) => void
  onAnnounce: (msg: string) => void
}
```

and add `onSetCwd, onAnnounce` to the destructured params.

**App.tsx** — edit the `<StatusBar …>` JSX call (at **App.tsx ~536–543**, the block with
`cliAvailable={claudeOk}` — NOT the `onSetCwd` at App.tsx:446, which belongs to ChatView and
stays as-is). The `setCwd` reducer action already exists (useSessions.ts case `'setCwd'`), and
`setLiveStatus` is the existing aria-live setter (App.tsx:454) used by the TTS band-aid. Add the
two new props:

```tsx
      <StatusBar
        session={activeSession}
        loggedIn={auth.status.loggedIn}
        cliAvailable={claudeOk}
        permissionMode={permissionMode}
        onConnect={() => void auth.login()}
        onDisconnect={() => void auth.logout()}
        onSetCwd={(path) => sessionsDispatch({ type: 'setCwd', sessionId: activeSession.id, cwd: path })}
        onAnnounce={setLiveStatus}
      />
```

> Verify `setLiveStatus` is in scope in App.tsx (it backs the `<div role="status" aria-live>`
> at App.tsx:454). If the setter has a different name, use that name.

- [ ] Edit `StatusBar.tsx` (props, left group, drop dup cwd span, imports)
- [ ] Edit `App.tsx` (two new props)
- [ ] Full gate: `npm run typecheck && npm test && npm run build` all green

---

## Done criteria

- [ ] `npm run typecheck` clean
- [ ] `npm test` green (new: git parsers + recentFolders; existing 74 unaffected)
- [ ] `npm run build` green
- [ ] Manual (real Electron, user): folder chip → Recent + Open folder switches cwd;
      branch chip → list + search + checkout (try a dirty tree → error announced);
      `📂+` creates a worktree and switches into it; worktree badge shows in a linked worktree.

## Out of scope (explicitly dropped)

- Environment picker (Local/Cloud/Remote Control/SSH) — only Local is possible; removed.
- Branch create-from-picker (only via worktree "new branch"); fetch/pull/push; remote branches.
