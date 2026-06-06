import { X, Plus, Circle } from 'lucide-react'
import type { Session, SessionStatus } from '@/mock/fixtures'

interface TabStripProps {
  sessions: Session[]
  activeSessionId: string
  onSelect: (id: string) => void
}

const STATUS_COLOR: Record<SessionStatus, string> = {
  active: 'text-accent',
  running: 'text-success',
  idle: 'text-fg-muted',
  error: 'text-destructive',
}

export function TabStrip({ sessions, activeSessionId, onSelect }: TabStripProps): JSX.Element {
  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-surface">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-thin">
        {sessions.map((s) => {
          const active = s.id === activeSessionId
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={`group flex max-w-[200px] items-center gap-2 border-r border-border px-3 text-sm transition-colors ${
                active
                  ? 'bg-bg text-fg'
                  : 'bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              {active && <span className="absolute left-0 top-0 h-0.5 w-full bg-accent" />}
              <Circle size={8} className={`shrink-0 fill-current ${STATUS_COLOR[s.status]}`} />
              <span className="truncate">{s.title}</span>
              <X
                size={13}
                className="shrink-0 rounded opacity-0 transition-opacity hover:bg-surface-2 group-hover:opacity-60"
              />
            </button>
          )
        })}
      </div>
      <button
        type="button"
        title="New session"
        className="flex w-9 items-center justify-center text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
