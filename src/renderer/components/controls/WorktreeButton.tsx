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
