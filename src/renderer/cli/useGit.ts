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
