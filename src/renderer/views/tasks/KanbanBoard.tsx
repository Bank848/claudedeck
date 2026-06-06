import { KANBAN_COLUMNS, KANBAN_CARDS } from '@/mock/fixtures'
import type { KanbanColumnId } from '@/mock/fixtures'

export default function KanbanBoard(): JSX.Element {
  return (
    <div className="h-full overflow-x-auto bg-bg">
      <div className="inline-flex gap-4 p-4">
        {KANBAN_COLUMNS.map((column) => (
          <KanbanColumn key={column.id} columnId={column.id} title={column.title} />
        ))}
      </div>
    </div>
  )
}

interface KanbanColumnProps {
  columnId: KanbanColumnId
  title: string
}

function KanbanColumn({ columnId, title }: KanbanColumnProps): JSX.Element {
  const cards = KANBAN_CARDS.filter((card) => card.column === columnId)

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-md border border-border bg-surface/40">
      {/* Column Header */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <span className="text-xs text-fg-muted">{cards.length}</span>
        </div>
      </div>

      {/* Column Body */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {cards.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded border-2 border-dashed border-border text-center">
            <p className="text-xs text-fg-muted">No cards</p>
          </div>
        ) : (
          cards.map((card) => (
            <KanbanCard
              key={card.id}
              title={card.title}
              tags={card.tags}
              priority={card.priority}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface KanbanCardProps {
  title: string
  tags: string[]
  priority: 'low' | 'medium' | 'high'
}

function KanbanCard({ title, tags, priority }: KanbanCardProps): JSX.Element {
  const priorityColor = {
    low: 'text-fg-muted',
    medium: 'text-accent',
    high: 'text-destructive',
  }[priority]

  return (
    <div className="group cursor-grab rounded-md border border-border bg-surface p-3 transition-colors hover:border-border-strong active:cursor-grabbing">
      <p className="mb-2 text-sm text-fg">{title}</p>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-muted px-1.5 py-0.5 text-xs text-fg-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Priority Indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${priorityColor}`}
          aria-label={`Priority: ${priority}`}
        />
        <span className={`text-xs ${priorityColor}`}>{priority}</span>
      </div>
    </div>
  )
}
