import { useEffect, useRef } from 'react'
import { Slash } from 'lucide-react'
import type { SlashCommand } from './slashCommands'

export interface SlashCommandMenuProps {
  /** Filtered commands to show (already ordered). */
  items: SlashCommand[]
  /** Index of the highlighted row. */
  activeIndex: number
  /** Commit a command (click or pointer). */
  onSelect: (cmd: SlashCommand) => void
  /** Highlight a row on hover so mouse + keyboard stay in sync. */
  onHover: (index: number) => void
  /** Stable id base so the textarea can point aria-activedescendant at the active row. */
  listboxId: string
  th: boolean
}

/**
 * Autocomplete popover for slash commands, anchored above the composer.
 * The textarea keeps DOM focus and drives selection via the keyboard; this is
 * a `role="listbox"` whose active row is referenced by `aria-activedescendant`
 * on the textarea, so a screen reader announces each command + description as
 * the user arrows through (blind users are first-class here).
 */
export function SlashCommandMenu({
  items,
  activeIndex,
  onSelect,
  onHover,
  listboxId,
  th,
}: SlashCommandMenuProps): JSX.Element | null {
  const activeRef = useRef<HTMLLIElement>(null)

  // Keep the highlighted row scrolled into view as the user arrows past the edges.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (items.length === 0) return null

  return (
    <div className="px-3 pt-2">
      <ul
        id={listboxId}
        role="listbox"
        aria-label={th ? 'คำสั่งสแลช' : 'Slash commands'}
        className="max-h-56 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg"
      >
        {items.map((cmd, i) => {
          const active = i === activeIndex
          return (
            <li
              key={cmd.name}
              ref={active ? activeRef : undefined}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={active}
              onMouseDown={(e) => {
                // Prevent the textarea from losing focus before we commit.
                e.preventDefault()
                onSelect(cmd)
              }}
              onMouseEnter={() => onHover(i)}
              className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm ${
                active ? 'bg-accent/15 text-fg' : 'text-fg-muted hover:bg-surface-2'
              }`}
            >
              <Slash size={13} className="shrink-0 text-accent" />
              <span className="font-mono text-fg">{cmd.name}</span>
              <span className="truncate text-xs text-fg-muted">{cmd.desc}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
