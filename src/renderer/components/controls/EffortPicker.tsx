import { useRef, useState } from 'react'
import { Check, Gauge } from 'lucide-react'
import type { Effort } from '@/cli/types'
import { EFFORT_OPTIONS, effortLabel } from '@/settings/effortLevels'
import { Pill, Popover, usePopover, nextRovingIndex } from '../Pill'

interface EffortPickerProps {
  /** undefined = Auto (no --effort flag). */
  value?: Effort
  onChange: (effort?: Effort) => void
}

export function EffortPicker({ value, onChange }: EffortPickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const pick = (effort?: Effort): void => {
    onChange(effort)
    close()
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive((i) => nextRovingIndex(i, EFFORT_OPTIONS.length, e.key))
    } else if (/^[1-9]$/.test(e.key)) {
      const opt = EFFORT_OPTIONS.find((o) => o.shortcut === Number(e.key))
      if (opt) pick(opt.effort)
    } else if (e.key === 'Enter') {
      pick(EFFORT_OPTIONS[active].effort)
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Pill
        ref={triggerRef}
        icon={<Gauge size={12} className="text-accent" />}
        label={effortLabel(value)}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        ariaLabel={`Effort: ${effortLabel(value)}. Activate to change.`}
        haspopup="listbox"
      />
      {open && (
        <Popover role="listbox" ariaLabel="Reasoning effort" width="w-56">
          <ul className="py-1" onKeyDown={onKeyDown}>
            {EFFORT_OPTIONS.map((o, i) => (
              <li key={o.effort ?? 'auto'}>
                <button
                  type="button"
                  role="option"
                  data-roving
                  aria-selected={o.effort === value}
                  tabIndex={i === active ? 0 : -1}
                  onFocus={() => setActive(i)}
                  onClick={() => pick(o.effort)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    o.effort === value ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2'
                  }`}
                >
                  <span className="w-4 text-center font-mono text-xs text-fg-muted">{o.shortcut}</span>
                  <span className="flex-1">{o.label}</span>
                  {o.effort === value && <Check size={14} className="text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  )
}
