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
