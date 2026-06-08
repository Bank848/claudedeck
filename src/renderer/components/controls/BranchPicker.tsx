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
