import { useRef, useState } from 'react'
import { Plus, FolderPlus, Slash, Image, Plug, Puzzle, ChevronRight } from 'lucide-react'
import { Pill, Popover, usePopover } from '../Pill'
import { pickDirectory } from '@/system/pickDirectory'

interface PlusMenuProps {
  /** Insert "/" into the composer and focus it. */
  onSlash: () => void
  /** Set the active session cwd to a chosen directory. */
  onPickFolder: (path: string) => void
}

export function PlusMenu({ onSlash, onPickFolder }: PlusMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const addFolder = async (): Promise<void> => {
    const path = await pickDirectory()
    if (path) onPickFolder(path)
    close()
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Pill
        ref={triggerRef}
        icon={<Plus size={14} />}
        label=""
        open={open}
        onToggle={() => setOpen((o) => !o)}
        ariaLabel="Add to conversation"
        haspopup="menu"
        chevron={false}
      />
      {open && (
        <Popover role="menu" ariaLabel="Add to conversation" width="w-60">
          <ul className="py-1 text-sm">
            <MenuRow disabled icon={<Image size={14} />} label="Add files or photos" hint="Ctrl+U" title="Coming soon" />
            <MenuRow icon={<FolderPlus size={14} />} label="Add folder" onClick={() => void addFolder()} />
            <MenuRow
              icon={<Slash size={14} />}
              label="Slash commands"
              onClick={() => {
                onSlash()
                close()
              }}
            />
            <div className="my-1 border-t border-border" />
            <MenuRow disabled icon={<Plug size={14} />} label="Connectors" caret title="Coming soon" />
            <MenuRow disabled icon={<Puzzle size={14} />} label="Plugins" caret title="Coming soon" />
          </ul>
        </Popover>
      )}
    </div>
  )
}

function MenuRow({
  icon, label, hint, caret, disabled, title, onClick,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  caret?: boolean
  disabled?: boolean
  title?: string
  onClick?: () => void
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        data-roving={disabled ? undefined : true}
        disabled={disabled}
        title={title}
        onClick={onClick}
        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
          disabled ? 'cursor-not-allowed text-fg-muted opacity-50' : 'text-fg hover:bg-surface-2'
        }`}
      >
        <span className="text-fg-muted">{icon}</span>
        <span className="flex-1">{label}</span>
        {hint && <span className="font-mono text-[11px] text-fg-muted">{hint}</span>}
        {caret && <ChevronRight size={13} className="text-fg-muted" />}
      </button>
    </li>
  )
}
