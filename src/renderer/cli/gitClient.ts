import type { GitStatus, Worktree } from '../../../electron/git'

// Mirror claudeClient.ts/authClient.ts: `claudedeck` is typed present but is
// ABSENT at runtime in the vite browser preview, so guard `typeof window`.
type ClaudeDeckGit = NonNullable<Window['claudedeck']>['git']
const git = (): ClaudeDeckGit | undefined =>
  typeof window !== 'undefined' ? window.claudedeck?.git : undefined

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
  forkWorktree: (
    args: { cwd: string; branch: string },
  ): Promise<{ ok: boolean; path?: string; branch?: string; error?: string }> =>
    git()?.forkWorktree(args) ?? Promise.resolve({ ok: false, error: 'unavailable' }),
}
