import { useRef, useState } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import type { PermissionMode } from '@/cli/types'
import { MODE_OPTIONS, modeLabel } from '@/settings/permissionModes'
import { Pill, Popover, usePopover, nextRovingIndex } from '../Pill'

interface ModePickerProps {
  value: PermissionMode
  onChange: (mode: PermissionMode) => void
}

export function ModePicker({ value, onChange }: ModePickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const pick = (mode: PermissionMode): void => {
    onChange(mode)
    close()
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive((i) => nextRovingIndex(i, MODE_OPTIONS.length, e.key))
    } else if (/^[1-9]$/.test(e.key)) {
      const opt = MODE_OPTIONS.find((o) => o.shortcut === Number(e.key))
      if (opt) pick(opt.mode)
    } else if (e.key === 'Enter') {
      pick(MODE_OPTIONS[active].mode)
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Pill
        ref={triggerRef}
        icon={<ShieldCheck size={12} className="text-accent" />}
        label={modeLabel(value)}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        ariaLabel={`Permission mode: ${modeLabel(value)}. Activate to change.`}
        haspopup="listbox"
      />
      {open && (
        <Popover role="listbox" ariaLabel="Permission mode" width="w-56">
          <ul className="py-1" onKeyDown={onKeyDown}>
            {MODE_OPTIONS.map((o, i) => (
              <li key={o.mode}>
                <button
                  type="button"
                  role="option"
                  data-roving
                  aria-selected={o.mode === value}
                  tabIndex={i === active ? 0 : -1}
                  onFocus={() => setActive(i)}
                  onClick={() => pick(o.mode)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    o.mode === value ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2'
                  }`}
                >
                  <span className="w-4 text-center font-mono text-xs text-fg-muted">{o.shortcut}</span>
                  <span className="flex-1">{o.label}</span>
                  {o.mode === value && <Check size={14} className="text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  )
}
