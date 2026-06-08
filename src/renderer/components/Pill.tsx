import { forwardRef, useEffect, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/** Pure roving-focus index math (arrow/Home/End), wraps; -1 when empty. */
export function nextRovingIndex(current: number, count: number, key: string): number {
  if (count === 0) return -1
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return current
  }
}

/**
 * Close `open` on outside-mousedown or Escape. `ref` must wrap BOTH the trigger
 * and the popover so clicks inside either are treated as "inside".
 */
export function usePopover(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, ref])
}

interface PillProps {
  label: string
  icon?: ReactNode
  open: boolean
  onToggle: () => void
  ariaLabel: string
  /** ARIA popup role of the panel this pill controls. */
  haspopup: 'menu' | 'listbox' | 'dialog'
  /** Hide the chevron (e.g. the icon-only Plus pill). */
  chevron?: boolean
}

export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  { label, icon, open, onToggle, ariaLabel, haspopup, chevron = true },
  ref,
): JSX.Element {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-haspopup={haspopup}
      aria-expanded={open}
      aria-label={ariaLabel}
      className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {icon}
      {label && <span className="text-fg">{label}</span>}
      {chevron && <ChevronDown size={11} />}
    </button>
  )
})

interface PopoverProps {
  role: 'menu' | 'listbox' | 'dialog'
  ariaLabel: string
  children: ReactNode
  /** Tailwind width class, e.g. "w-64". */
  width?: string
  /** Anchor edge. 'right' opens leftward (for controls in the right group). */
  align?: 'left' | 'right'
}

/** Upward-opening panel (bottom bar). Caller owns open/close + focus. */
export function Popover({ role, ariaLabel, children, width = 'w-64', align = 'left' }: PopoverProps): JSX.Element {
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={`absolute bottom-full ${align === 'right' ? 'right-0' : 'left-0'} z-50 mb-2 ${width} overflow-hidden rounded-lg border border-border bg-surface shadow-xl`}
    >
      {children}
    </div>
  )
}
