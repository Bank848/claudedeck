import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import type { Session, Todo } from '@/mock/fixtures'
import { deriveTodos } from '@/cli/deriveSessionState'

interface TodoPanelProps {
  session: Session
}

export default function TodoPanel({ session }: TodoPanelProps): JSX.Element {
  const todos: Todo[] = deriveTodos(session.messages)
  const completed = todos.filter((t) => t.status === 'completed').length
  const total = todos.length

  // Derive running tools from session messages
  const runningTools = session.messages
    .flatMap((msg) => msg.parts)
    .filter((part) => part.kind === 'tool' && part.call.status === 'running')
    .map((part) => (part.kind === 'tool' ? part.call : null))
    .filter((call) => call !== null)

  return (
    <div className="space-y-6 p-3">
      {/* Todos Section */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Todos
          </h3>
          <span className="text-xs text-fg-muted">
            {completed} / {total}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: total > 0 ? `${(completed / total) * 100}%` : '0%' }}
          />
        </div>

        {/* Todo List */}
        {total === 0 ? (
          <p className="text-xs text-fg-muted">No todos</p>
        ) : (
          <ul className="space-y-1.5">
            {todos.map((todo) => (
              <li key={todo.id} className="flex items-start gap-2">
                <TodoIcon status={todo.status} />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs ${
                      todo.status === 'completed'
                        ? 'line-through text-fg-muted'
                        : 'text-fg'
                    }`}
                  >
                    {todo.title}
                  </p>
                  {todo.status === 'in_progress' && todo.activeForm && (
                    <p className="mt-0.5 text-xs text-accent">{todo.activeForm}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Running Tools Section */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Running Tools
        </h3>
        {runningTools.length === 0 ? (
          <p className="text-xs text-fg-muted">No active tool runs</p>
        ) : (
          <ul className="space-y-1.5">
            {runningTools.map((tool) => (
              <li
                key={tool.id}
                className="flex items-center gap-2 rounded border border-border bg-surface-2 p-1.5 text-xs"
              >
                <Loader2 size={12} className="animate-spin text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-fg">{tool.tool}</p>
                  <p className="truncate text-fg-muted">{tool.label}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function TodoIcon({ status }: { status: string }): JSX.Element {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={16} className="shrink-0 text-success" />
    case 'in_progress':
      return <Loader2 size={16} className="animate-spin shrink-0 text-accent" />
    case 'pending':
    default:
      return <Circle size={16} className="shrink-0 text-fg-muted" />
  }
}
