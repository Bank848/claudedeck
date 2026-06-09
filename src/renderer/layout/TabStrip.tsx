import { X, Plus, Circle } from 'lucide-react'
import type { Session, SessionStatus } from '@/mock/fixtures'

interface TabStripProps {
  sessions: Session[]
  activeSessionId: string
  onSelect: (id: string) => void
  onNew: () => void
  onClose: (id: string) => void
}

const STATUS_COLOR: Record<SessionStatus, string> = {
  active: 'text-accent',
  running: 'text-success',
  idle: 'text-fg-muted',
  error: 'text-destructive',
}

export function TabStrip({ sessions, activeSessionId, onSelect, onNew, onClose }: TabStripProps): JSX.Element {
  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-surface" role="tablist" aria-label="Open sessions">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-thin">
        {sessions.map((s) => {
          const active = s.id === activeSessionId
          // Outer wrapper keeps `group relative`: `relative` anchors the active
          // underline span; `group` drives the close button's hover reveal. The
          // select + close are sibling <button>s (never nested — invalid HTML).
          return (
            <div
              key={s.id}
              className={`group relative flex max-w-[200px] items-stretch border-r border-border text-sm transition-colors ${
                active ? 'bg-bg text-fg' : 'bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              {active && <span className="absolute left-0 top-0 h-0.5 w-full bg-accent" />}
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? 'page' : undefined}
                className="flex min-w-0 items-center gap-2 py-0 pl-3 pr-1"
              >
                <Circle size={8} className={`shrink-0 fill-current ${STATUS_COLOR[s.status]}`} />
                <span className="truncate">{s.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${s.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(s.id)
                }}
                className="flex shrink-0 items-center rounded pr-2 pl-0.5 opacity-0 transition-opacity hover:text-fg group-hover:opacity-60 focus-visible:opacity-100"
              >
                <X size={13} className="rounded hover:bg-surface-2" />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        title="New session"
        aria-label="New session"
        onClick={onNew}
        className="flex w-9 items-center justify-center text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
