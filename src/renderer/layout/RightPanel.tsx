import { X, ListChecks } from 'lucide-react'
import type { Session } from '@/mock/fixtures'
import TodoPanel from '@/views/tasks/TodoPanel'

interface RightPanelProps {
  session: Session
  onClose: () => void
}

export function RightPanel({ session, onClose }: RightPanelProps): JSX.Element {
  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border bg-surface">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          <ListChecks size={14} />
          Tasks &amp; Activity
        </span>
        <button
          type="button"
          title="Hide panel"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TodoPanel session={session} />
      </div>
    </aside>
  )
}
