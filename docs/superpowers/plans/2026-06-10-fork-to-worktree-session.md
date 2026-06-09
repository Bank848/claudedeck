# Plan: Fork to a new git-worktree-bound session

> ClaudeDeck — accessibility-first Electron + React + TypeScript GUI wrapping the `claude` CLI.
> Base branch: `feat/session-context-persistence` (persistence already landed; `createSession` /
> `closeSession` exist in `src/renderer/state/useSessions.ts`).
> Design approved in chat 2026-06-10. Output: single reviewed `.md` (per user preference).

## Goal

One action — surfaced in four places — that:

1. creates a **new git worktree** on a **new branch**, then
2. opens a **new session tab** whose `cwd` is that worktree path, then
3. **optionally seeds a starting prompt** (sent automatically once the new tab is live), then
4. **switches to** the new tab.

Lets heavy/parallel work run isolated from the current session, mirroring Claude Code's own
`spawn_task` chip. Built on the existing `git.worktreeAdd` IPC and the landed `createSession`
reducer action — **no changes to the persistence reducer**.

## Architecture

```
┌─ main process ──────────────────────────────────────────────┐
│ electron/git.ts                                              │
│   forkWorktreePath(repoRoot, branch)  [pure]                 │
│   gitForkWorktree(cwd, branch)  → rev-parse --show-toplevel  │
│                                   → gitWorktreeAdd(...,true)  │
│ electron/main.ts   ipc 'git:fork-worktree'                   │
└──────────────────────────────────────────────────────────────┘
        │ preload: window.claudedeck.git.forkWorktree({cwd,branch})
        ▼
┌─ renderer ──────────────────────────────────────────────────┐
│ src/renderer/cli/gitClient.ts   forkWorktree(...)            │
│ src/renderer/state/forkSession.ts  slugify / defaultForkBranch│
│                                    / isValidBranchName  [pure]│
│ src/renderer/views/chat/ForkDialog.tsx   accessible modal    │
│ src/renderer/App.tsx   openFork / confirmFork / pendingSeed  │
│        ├─ TabStrip.tsx        per-tab Fork button            │
│        ├─ Composer.tsx        Fork-with-message button       │
│        ├─ SessionsPanel.tsx   "Fork active session" button   │
│        └─ Ctrl+Shift+B hotkey + "fork"/"แยกเซสชัน" voice cmd │
└──────────────────────────────────────────────────────────────┘
```

**Data flow (success):** affordance → `openFork(seed?)` → `ForkDialog` (editable branch + optional
prompt) → `confirmFork` → `gitClient.forkWorktree` → on `ok`: build `Session{cwd: result.path,
title: branch}` → `createSession` → `setActiveSessionId` → set `pendingSeed` → announce. A seed
effect fires `handleSend` once the forked tab is active + idle. New session auto-persists via the
existing debounced `saveIndex` effect.

**Data flow (failure):** `forkWorktree` returns `{ok:false,error}` → announce error via
`speakStatus` (TH/EN), keep dialog open, create no session.

## Tech stack

- Vitest (`npm test` → `vitest run`), TypeScript strict (`npm run typecheck` → `tsc --noEmit`),
  build `npm run build` → `electron-vite build`.
- `lucide-react` `GitBranch` icon (already a dependency).
- No new dependencies.

## File structure

```
electron/git.ts                              (MODIFY: + forkWorktreePath, gitForkWorktree)
electron/git.test.ts                         (MODIFY: + tests)
electron/main.ts                             (MODIFY: + ipc 'git:fork-worktree')
electron/preload.ts                          (MODIFY: + git.forkWorktree)
src/renderer/cli/gitClient.ts                (MODIFY: + forkWorktree)
src/renderer/state/forkSession.ts            (NEW: pure helpers)
src/renderer/state/forkSession.test.ts       (NEW: tests)
src/renderer/views/chat/ForkDialog.tsx       (NEW: accessible modal)
src/renderer/App.tsx                          (MODIFY: handler + state + render + hotkey + voice + prop wiring)
src/renderer/layout/TabStrip.tsx             (MODIFY: + onFork prop + button)
src/renderer/views/chat/ChatView.tsx         (MODIFY: + onFork pass-through)
src/renderer/views/chat/Composer.tsx         (MODIFY: + onFork button)
src/renderer/views/sessions/SessionsPanel.tsx(MODIFY: + onFork button)
src/renderer/layout/Sidebar.tsx              (MODIFY: + onFork pass-through)
```

---

## Parallelization Analysis

Task dependency view (files touched are disjoint within each batch):

- **Batch 1 — fully parallel** (no shared files):
  - **Task 1** backend `electron/git.ts` + `electron/git.test.ts`
  - **Task 2** `src/renderer/state/forkSession.ts` + `.test.ts`
  - **Task 5** `src/renderer/layout/TabStrip.tsx`
  - **Task 6** `src/renderer/views/chat/Composer.tsx` + `ChatView.tsx`
  - **Task 7** `src/renderer/views/sessions/SessionsPanel.tsx` + `src/renderer/layout/Sidebar.tsx`
- **Batch 2 — parallel** (each depends on Batch 1, disjoint from each other):
  - **Task 3** IPC wiring `electron/main.ts` + `electron/preload.ts` + `src/renderer/cli/gitClient.ts` (needs Task 1)
  - **Task 4** `src/renderer/views/chat/ForkDialog.tsx` (needs Task 2)
- **Batch 3 — sequential** (depends on everything):
  - **Task 8** `src/renderer/App.tsx` — wires state/handlers/effect/render/hotkey/voice and passes the
    new props into TabStrip / ChatView / Sidebar (which Tasks 5/6/7 already taught to accept).
- **Final pass:** `/code-review` + `/simplify` in parallel, then apply findings.

**Critical path (length 3):** Task 1 → Task 3 → Task 8 (or Task 2 → Task 4 → Task 8).

> ⚠️ All four affordance tasks (5/6/7 + the SessionsPanel half of 7) only **add an optional
> `onFork` prop** to their own component files. App.tsx is touched by **Task 8 only** — this is
> what keeps Batches 1–2 conflict-free.

---

## Task 1 — Backend: `forkWorktreePath` + `gitForkWorktree`

Files: `electron/git.ts`, `electron/git.test.ts`. Reuses existing `runGit`, `isValidRef`,
`gitWorktreeAdd`.

- [ ] Add the pure path helper and runner to `electron/git.ts` (after `gitWorktreeAdd`, end of file):

```ts
import { dirname, basename, join } from 'node:path'
```
(add to the existing imports at the top of `electron/git.ts`; it currently imports from
`node:child_process` and `node:fs` only.)

```ts
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
```

- [ ] Append tests to `electron/git.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { forkWorktreePath } from './git'

describe('forkWorktreePath', () => {
  it('places a sibling <name>-worktrees dir, slashes dashed', () => {
    expect(forkWorktreePath('/code/ClaudeDeck', 'fork/fix-auth').replace(/\\/g, '/'))
      .toBe('/code/ClaudeDeck-worktrees/fork-fix-auth')
  })
  it('handles a trailing separator on the root', () => {
    expect(forkWorktreePath('/code/ClaudeDeck/', 'fork/x').replace(/\\/g, '/'))
      .toBe('/code/ClaudeDeck-worktrees/fork-x')
  })
  it('uses the leaf dir name for a nested repo root', () => {
    expect(forkWorktreePath('/a/b/myrepo', 'fork/y').replace(/\\/g, '/'))
      .toBe('/a/b/myrepo-worktrees/fork-y')
  })
})
```
> Note: `gitForkWorktree` itself spawns `git`; its delegation is covered indirectly by the pure
> `forkWorktreePath` test plus the existing `gitWorktreeAdd` tests. Do not add a brittle
> spawn-mocking test unless `electron/git.test.ts` already mocks `runGit` (check the file head —
> if it does, mirror that style to assert `--show-toplevel` is parsed and `newBranch=true` is passed).

- [ ] `npx vitest run electron/git.test.ts` green.

---

## Task 2 — Renderer pure helpers: `forkSession.ts`

Files: `src/renderer/state/forkSession.ts` (NEW), `src/renderer/state/forkSession.test.ts` (NEW).

- [ ] Create `src/renderer/state/forkSession.ts`:

```ts
/**
 * Pure helpers for the "fork to new worktree" feature. No React, no IPC — unit-testable.
 * Branch names produced here MUST satisfy the main-process `isValidRef` guard in
 * electron/git.ts (regex /^[^\s-][^\s~^:?*[\\]*$/ and no '..'); `isValidBranchName` below
 * mirrors that rule for the dialog's client-side guard.
 */

/** lowercase, non-alphanumerics → dashes, collapse + trim dashes, cap length. */
export function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '')
}

/** YYYYMMDD-HHMMSS in local time, zero-padded. */
function stamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  )
}

/**
 * Default branch for a fork: `fork/<slug of first ~6 words of seed>`, or
 * `fork/<timestamp>` when there is no usable seed. Always a valid ref.
 */
export function defaultForkBranch(seed: string, now: Date): string {
  const slug = slugify(seed.split(/\s+/).slice(0, 6).join(' '))
  return slug ? `fork/${slug}` : `fork/${stamp(now)}`
}

/** Mirror of electron/git.ts isValidRef — for the dialog's Fork-button enable guard. */
export function isValidBranchName(name: string): boolean {
  return /^[^\s-][^\s~^:?*[\\]*$/.test(name) && !name.includes('..')
}
```

- [ ] Create `src/renderer/state/forkSession.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { slugify, defaultForkBranch, isValidBranchName } from './forkSession'
import { isValidRef } from '../../../electron/git'

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('Fix the Auth Bug!')).toBe('fix-the-auth-bug')
  })
  it('collapses and trims dashes', () => {
    expect(slugify('  a   b  ')).toBe('a-b')
  })
  it('caps length without a trailing dash', () => {
    expect(slugify('x'.repeat(60)).length).toBeLessThanOrEqual(40)
    expect(slugify('aaaa '.repeat(20)).endsWith('-')).toBe(false)
  })
})

describe('defaultForkBranch', () => {
  const now = new Date(2026, 5, 10, 0, 38, 47) // 2026-06-10 00:38:47 local
  it('derives a fork/<slug> from the seed', () => {
    expect(defaultForkBranch('Refactor the session reducer', now)).toBe('fork/refactor-the-session-reducer')
  })
  it('uses a timestamp when the seed is empty', () => {
    expect(defaultForkBranch('   ', now)).toBe('fork/20260610-003847')
  })
  it('produces names that pass the main-process isValidRef guard', () => {
    expect(isValidRef(defaultForkBranch('Fix the Auth Bug!', now))).toBe(true)
    expect(isValidRef(defaultForkBranch('', now))).toBe(true)
  })
})

describe('isValidBranchName', () => {
  it('accepts fork/slug, rejects spaces / leading dash / ..', () => {
    expect(isValidBranchName('fork/fix-auth')).toBe(true)
    expect(isValidBranchName('has space')).toBe(false)
    expect(isValidBranchName('-leading')).toBe(false)
    expect(isValidBranchName('a..b')).toBe(false)
  })
})
```
> The cross-import of `isValidRef` from `electron/git.ts` runs fine under Vitest's node env and
> guarantees the two regexes can't drift. If the relative path resolves awkwardly, import via the
> repo's configured alias instead; keep the assertion.

- [ ] `npx vitest run src/renderer/state/forkSession.test.ts` green.

---

## Task 5 — TabStrip per-tab Fork button

File: `src/renderer/layout/TabStrip.tsx`. Add an **optional** `onFork` prop and a focusable
`GitBranch` button mirroring the existing close button's reveal-on-hover + focus-visible pattern.
A sibling `<button>` (never nested).

- [ ] Edit imports + props:

```tsx
import { X, Plus, Circle, GitBranch } from 'lucide-react'
import type { Session, SessionStatus } from '@/mock/fixtures'

interface TabStripProps {
  sessions: Session[]
  activeSessionId: string
  onSelect: (id: string) => void
  onNew: () => void
  onClose: (id: string) => void
  /** Fork this tab's session into a new worktree-bound session. */
  onFork?: (id: string) => void
}

export function TabStrip({ sessions, activeSessionId, onSelect, onNew, onClose, onFork }: TabStripProps): JSX.Element {
```

- [ ] Insert the Fork button **before** the existing close button (inside the per-tab wrapper,
  after the select `<button>`):

```tsx
              {onFork && (
                <button
                  type="button"
                  aria-label={`Fork ${s.title} to new worktree`}
                  title="Fork to new worktree"
                  onClick={(e) => {
                    e.stopPropagation()
                    onFork(s.id)
                  }}
                  className="flex shrink-0 items-center rounded px-0.5 opacity-0 transition-opacity hover:text-fg group-hover:opacity-60 focus-visible:opacity-100"
                >
                  <GitBranch size={12} className="rounded hover:bg-surface-2" />
                </button>
              )}
```

- [ ] Typecheck passes; no behavior change when `onFork` is omitted (existing tests unaffected).

---

## Task 6 — Composer Fork-with-message button + ChatView pass-through

Files: `src/renderer/views/chat/Composer.tsx`, `src/renderer/views/chat/ChatView.tsx`.

- [ ] `Composer.tsx` — import `GitBranch`, add optional prop, render button in the LEFT cluster:

```tsx
import { ArrowUp, Mic, GitBranch } from 'lucide-react'
```

Add to `ComposerProps`:
```tsx
  /** Fork to a new worktree session, seeding it with the current draft text. */
  onFork?: (seedText: string) => void
```

Destructure it: `function Composer({ model, onSend, busy = false, tokens, permissionMode, onChangePermission, onSetCwd, onFork }, ref)`.

Render after the `<ModePicker .../>`/`<EffortPicker .../>` in the left cluster:
```tsx
              {onFork && (
                <button
                  type="button"
                  onClick={() => onFork(value.trim())}
                  aria-label="Fork to new worktree with this message"
                  title="Fork to new worktree (carry this message)"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <GitBranch size={15} />
                </button>
              )}
```

- [ ] `ChatView.tsx` — thread `onFork` through:

Add to the props type: `onFork?: (seedText: string) => void` and destructure it. Pass to `<Composer ... onFork={onFork} />`.

- [ ] Typecheck passes; omitting `onFork` renders nothing new.

---

## Task 7 — SessionsPanel "Fork active session" button + Sidebar pass-through

Files: `src/renderer/views/sessions/SessionsPanel.tsx`, `src/renderer/layout/Sidebar.tsx`.
The button sits **above** the `<ul role="listbox">` — never inside the option `<button>`.

- [ ] `SessionsPanel.tsx` — import icon, add optional prop, wrap return so the Fork button is a
  sibling header above the list:

```tsx
import { GitBranch } from 'lucide-react'
import { type Session, type SessionStatus } from '@/mock/fixtures'
```

Props:
```tsx
export default function SessionsPanel({
  sessions,
  activeSessionId,
  onSelect,
  onFork,
}: {
  sessions: Session[]
  activeSessionId: string
  onSelect: (id: string) => void
  onFork?: () => void
}): JSX.Element {
```

Render the button above the list (applies in both the empty-state and populated returns — simplest
is to wrap each return's root, or add it once above the `<ul>`). Concretely, change the populated
return to:

```tsx
  return (
    <div className="flex flex-col">
      {onFork && (
        <button
          type="button"
          onClick={onFork}
          aria-label="Fork active session to a new worktree"
          className="mx-2 mb-1 mt-1 flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-left text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <GitBranch size={13} className="shrink-0" />
          <span className="truncate">Fork active session</span>
        </button>
      )}
      <ul role="listbox" aria-label="Sessions" className="space-y-1 px-2 py-1">
        {/* …existing <li> map unchanged… */}
      </ul>
    </div>
  )
```
> Leave the empty-state early-return as-is (no active session worth forking when the list is empty).

- [ ] `Sidebar.tsx` — add optional `onFork` to `SidebarProps`, thread through `SidebarBody`, pass to
  `<SessionsPanel ... onFork={onFork} />`:

```tsx
interface SidebarProps {
  activity: ActivityId
  sessions: Session[]
  activeSessionId: string
  onSelectSession: (id: string) => void
  onFork?: () => void
}
```
Destructure `onFork` in both `Sidebar` and `SidebarBody`, forward it in the `chat`/`sessions`
branch: `<SessionsPanel sessions={sessions} activeSessionId={activeSessionId} onSelect={onSelectSession} onFork={onFork} />`.

- [ ] Typecheck passes; omitting `onFork` shows no button.

---

## Task 3 — IPC wiring (depends on Task 1)

Files: `electron/main.ts`, `electron/preload.ts`, `src/renderer/cli/gitClient.ts`.

- [ ] `electron/main.ts` — import `gitForkWorktree` and register the handler next to
  `git:worktree-add` (~line 437):

```ts
// add gitForkWorktree to the existing import from './git'
ipcMain.handle('git:fork-worktree', (_e, args: { cwd: string; branch: string }) =>
  gitForkWorktree(args.cwd, args.branch),
)
```

- [ ] `electron/preload.ts` — add to the `git` object (after `worktreeAdd`, ~line 170):

```ts
    forkWorktree: (
      args: { cwd: string; branch: string },
    ): Promise<{ ok: boolean; path?: string; branch?: string; error?: string }> =>
      ipcRenderer.invoke('git:fork-worktree', args),
```

- [ ] `src/renderer/cli/gitClient.ts` — add the client method mirroring `worktreeAdd`'s
  unavailable-fallback shape:

```ts
  forkWorktree: (
    args: { cwd: string; branch: string },
  ): Promise<{ ok: boolean; path?: string; branch?: string; error?: string }> =>
    git()?.forkWorktree(args) ?? Promise.resolve({ ok: false, error: 'unavailable' }),
```

- [ ] `npm run typecheck` passes (preload `ClaudeDeckApi` type now exposes `forkWorktree`).

---

## Task 4 — `ForkDialog.tsx` (depends on Task 2)

File: `src/renderer/views/chat/ForkDialog.tsx` (NEW). Modeled on `PermissionPrompt.tsx`:
`role="dialog"`, `aria-modal`, `aria-labelledby`, autofocus the branch field, Escape = cancel,
focus trap. Fork disabled while the branch is empty/invalid.

- [ ] Create the file:

```tsx
import { useEffect, useRef, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { isValidBranchName } from '@/state/forkSession'

export interface ForkDialogProps {
  /** Prefilled, editable branch name. */
  defaultBranch: string
  /** Prefilled starting prompt (may be empty). */
  seed: string
  /** Confirm — only called with a valid branch. */
  onConfirm: (args: { branch: string; seed: string }) => void
  onCancel: () => void
  /** Active-language label pair picker from App (TH/EN). */
  th: boolean
}

export function ForkDialog({ defaultBranch, seed, onConfirm, onCancel, th }: ForkDialogProps): JSX.Element {
  const [branch, setBranch] = useState(defaultBranch)
  const [prompt, setPrompt] = useState(seed)
  const branchRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const forkRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    branchRef.current?.focus()
    branchRef.current?.select()
  }, [])

  const valid = isValidBranchName(branch.trim())
  const submit = (): void => {
    if (!valid) return
    onConfirm({ branch: branch.trim(), seed: prompt.trim() })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const t = (en: string, thai: string): string => (th ? thai : en)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onKeyDown={onKeyDown}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fork-title"
        aria-describedby="fork-desc"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <GitBranch size={18} className="text-accent" />
          <h2 id="fork-title" className="text-sm font-semibold text-fg">
            {t('Fork to a new worktree', 'แยกไปเวิร์กทรีใหม่')}
          </h2>
        </div>
        <p id="fork-desc" className="mb-3 text-xs text-fg-muted">
          {t(
            'Creates a new branch in a separate worktree and opens it as a new session. (Ctrl+Shift+B)',
            'สร้าง branch ใหม่ในเวิร์กทรีแยก แล้วเปิดเป็นเซสชันใหม่ (Ctrl+Shift+B)',
          )}
        </p>

        <label htmlFor="fork-branch" className="mb-1 block text-xs font-medium text-fg">
          {t('Branch name', 'ชื่อ branch')}
        </label>
        <input
          id="fork-branch"
          ref={branchRef}
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          aria-invalid={!valid}
          className="mb-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-border-strong focus:outline-none"
        />
        {!valid && (
          <p role="alert" className="mb-2 text-[11px] text-destructive">
            {t('Invalid branch name (no spaces, no leading dash, no "..").', 'ชื่อ branch ไม่ถูกต้อง')}
          </p>
        )}

        <label htmlFor="fork-seed" className="mb-1 mt-3 block text-xs font-medium text-fg">
          {t('Starting prompt (optional)', 'ข้อความเริ่มต้น (ไม่บังคับ)')}
        </label>
        <textarea
          id="fork-seed"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="mb-4 w-full resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-border-strong focus:outline-none"
        />

        <div className="flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            {t('Cancel (Esc)', 'ยกเลิก (Esc)')}
          </button>
          <button
            ref={forkRef}
            type="button"
            onClick={submit}
            disabled={!valid}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('Fork', 'แยก')}
          </button>
        </div>
      </div>
    </div>
  )
}
```
> Focus trap: keep it simple and accessible like `PermissionPrompt` — the dialog is small and the
> first field is autofocused; Escape cancels. A full Tab-cycle trap can be added if review asks, but
> the modal overlay + autofocus + Escape already meet the blind-first bar here.

- [ ] `npm run typecheck` passes.

---

## Task 8 — App.tsx: handler, state, render, hotkey, voice, prop wiring (depends on 2,3,4,5,6,7)

File: `src/renderer/App.tsx`. This is the only task that edits App.tsx.

- [ ] Imports:

```tsx
import { ForkDialog } from '@/views/chat/ForkDialog'
import { defaultForkBranch } from '@/state/forkSession'
import { gitClient } from '@/cli/gitClient'
```

- [ ] State (near the other `useState` declarations, ~line 72):

```tsx
  // `sourceCwd` is captured at openFork time (not read from activeSession at confirm time) so the
  // fork targets the intended repo even if the active tab changes between opening and confirming —
  // and so the per-tab Fork button forks the *clicked* tab, not whatever is active.
  const [forkState, setForkState] = useState<{ defaultBranch: string; seed: string; sourceCwd: string } | null>(null)
  const [pendingSeed, setPendingSeed] = useState<{ sessionId: string; text: string } | null>(null)
```

- [ ] `openFork` + `confirmFork` (place after `newSession` / `closeSessionTab`, ~line 599). Note
  `handleSend` is declared above this point, so the seed effect can reference it.

```tsx
  const openFork = (seed?: string, sourceCwd?: string): void => {
    setForkState({
      defaultBranch: defaultForkBranch(seed ?? '', new Date()),
      seed: seed ?? '',
      sourceCwd: sourceCwd ?? activeSession.cwd,
    })
  }

  const confirmFork = async ({ branch, seed }: { branch: string; seed: string }): Promise<void> => {
    if (!forkState) return
    const r = await gitClient.forkWorktree({ cwd: forkState.sourceCwd, branch })
    if (!r.ok || !r.path) {
      speakStatus(say({ th: `แยกไม่สำเร็จ: ${r.error ?? ''}`, en: `Fork failed: ${r.error ?? 'unknown error'}` }))
      return // keep dialog open
    }
    const id = nextId('s')
    const now = new Date().toISOString()
    sessionsDispatch({
      type: 'createSession',
      session: { ...emptySession(id), cwd: r.path, title: branch, updatedAt: now, createdAt: now },
    })
    setActiveSessionId(id)
    setActivity('chat')
    if (seed.trim()) setPendingSeed({ sessionId: id, text: seed.trim() })
    setForkState(null)
    speakStatus(say({ th: `แยกไปเซสชันใหม่ branch ${branch}`, en: `Forked to new session on branch ${branch}` }))
  }
```

- [ ] Seed-delivery effect (place after `handleSend`, anywhere below its declaration):

```tsx
  // Deliver a fork's starting prompt once the new session is active, idle and the CLI is up.
  // Fires exactly once (pendingSeed cleared before send).
  useEffect(() => {
    if (!pendingSeed) return
    if (activeSession.id !== pendingSeed.sessionId) return
    if (activeSession.status !== 'idle' || !claudeOk) return
    const text = pendingSeed.text
    setPendingSeed(null)
    handleSend(text, activeSession.model)
    // handleSend/activeSession intentionally read fresh each render; guarded by the id check above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeed, activeSession, claudeOk])
```

- [ ] Voice command — append to the `commands` array (after the `send` command, ~line 213):

```tsx
    { phrases: ['fork', 'fork session', 'fork to worktree', 'fork branch', 'แยกเซสชัน', 'แตกเซสชัน'], run: () => openFork(), confirm: th ? 'แยกเซสชัน' : 'Fork', label: '“fork” / “แยกเซสชัน”' },
```
> This `confirm` string is automatically warmed via `collectPrewarmPhrases({ extraConfirms: ... })`
> at ~line 281 — no extra prewarm work needed.

- [ ] Global hotkey Ctrl+Shift+B — add a `useEffect` mirroring the Ctrl+Shift+V block (~line 362):

```tsx
  // Ctrl+Shift+B → open the Fork dialog (fork the active session to a new worktree).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault()
        openFork()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] Wire the affordance props:
  - `<Sidebar ... onFork={() => openFork()} />` (Sidebar mounts SessionsPanel).
  - `<TabStrip ... onFork={(id) => { const s = sessions.find((x) => x.id === id); setActiveSessionId(id); openFork(undefined, s?.cwd) }} />`
    — switches to the clicked tab for UX, and passes that tab's `cwd` explicitly so the fork targets
    the *clicked* tab regardless of state-flush timing.
  - `<ChatView ... onFork={(text) => openFork(text)} />` in the `centerView` chat branch (defaults
    `sourceCwd` to the active session's cwd).

> ⚠️ `sourceCwd` is captured synchronously inside `openFork` (from the explicit arg or the current
> `activeSession.cwd`) and stored in `forkState`, so `confirmFork` never depends on a `setActiveSessionId`
> flush having occurred. This removes the timing fragility the reviewer flagged.

- [ ] Render the dialog before the closing `</div>` (next to the `PermissionPrompt` render, ~line 743):

```tsx
      {forkState && (
        <ForkDialog
          defaultBranch={forkState.defaultBranch}
          seed={forkState.seed}
          onConfirm={(args) => void confirmFork(args)}
          onCancel={() => setForkState(null)}
          th={th}
        />
      )}
```

- [ ] `npm run typecheck` passes; `npx vitest run` green.

---

## Verification before "done"

- [ ] `npx vitest run` — all suites green (new + existing).
- [ ] `npm run typecheck` — clean.
- [ ] `npm run build` — `electron-vite build` succeeds.
- [ ] Manual sanity (optional, via `npm run dev`): Ctrl+Shift+B opens the dialog; confirming on a
  real repo creates `<repo>-worktrees/<branch>` and a new active tab at that cwd; a seeded prompt
  auto-sends; error path (e.g. duplicate branch) announces and keeps the dialog open.

## Commits (conventional; attribution disabled globally)

Suggested granularity (one per batch, or per task if preferred):
- `feat(fork): worktree-path helper + gitForkWorktree backend + IPC`
- `feat(fork): pure branch-naming helpers (slugify/defaultForkBranch)`
- `feat(fork): accessible ForkDialog + App handler, seed delivery, hotkey + voice`
- `feat(fork): tab / composer / sessions-panel fork affordances`

## Accessibility checklist (blind-first)

- [ ] Every new control has an `aria-label`; all are keyboard-reachable (`focus-visible` rings).
- [ ] Dialog: `role="dialog"`, `aria-modal`, `aria-labelledby`/`aria-describedby`, branch field
      autofocused, Escape cancels, invalid branch announced via `role="alert"`.
- [ ] Success and failure both announced via `speakStatus` (TH/EN) → existing `aria-live` region.
- [ ] Voice command (`fork` / `แยกเซสชัน`) with spoken confirmation; warmed via existing prewarm.
- [ ] Hotkey Ctrl+Shift+B shown in the dialog description copy (above) and discoverable via voice "help".
- [ ] Note (acceptable behavior): if `claudeOk` is false when a seeded fork is confirmed, `pendingSeed`
      stays queued and delivers automatically once the CLI becomes available — the seed is not lost.
      The fork itself (worktree + tab) still succeeds and is announced.
