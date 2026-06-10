import { GitBranch, Plus } from 'lucide-react'
import { type Session, type SessionStatus } from '@/mock/fixtures'

const STATUS_DOT: Record<SessionStatus, string> = {
  active: 'bg-accent',
  running: 'bg-success',
  idle: 'bg-fg-muted',
  error: 'bg-destructive',
}

function getRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()

  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function formatCwdBasename(cwd: string): string {
  return cwd.split(/[/\\]/).filter(Boolean).pop() || cwd
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(0)}K`
  return `${(tokens / 1000000).toFixed(1)}M`
}

export default function SessionsPanel({
  sessions,
  activeSessionId,
  onSelect,
  onFork,
  onNew,
}: {
  sessions: Session[]
  activeSessionId: string
  onSelect: (id: string) => void
  onFork?: () => void
  onNew?: () => void
}): JSX.Element {
  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-3 py-8 text-center">
        <div className="mb-2 text-2xl opacity-50">∅</div>
        <p className="text-xs text-fg-muted">No sessions yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {onNew && (
        <button
          type="button"
          onClick={onNew}
          aria-label="New session"
          className="mx-2 mb-1 mt-2 flex items-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-left text-xs font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus size={13} className="shrink-0" />
          <span>New session</span>
        </button>
      )}
      {onFork && (
        <button
          type="button"
          onClick={onFork}
          aria-label="Fork the active conversation into a new tab"
          title="Fork conversation — copies the chat into a new tab (Ctrl+Shift+B)"
          className="mx-2 mb-1 mt-1 flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-left text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <GitBranch size={13} className="shrink-0" />
          <span className="truncate">Fork active session</span>
        </button>
      )}
      <ul role="listbox" aria-label="Sessions" className="space-y-1 px-2 py-1">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId
        return (
          <li key={session.id} role="option" aria-selected={isActive}>
            <button
              type="button"
              onClick={() => onSelect(session.id)}
              aria-label={`${session.title}, ${formatCwdBasename(session.cwd)}, ${session.model}, ${getRelativeTime(session.updatedAt)}`}
              className={`group relative flex w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                isActive
                  ? 'bg-surface-2'
                  : 'hover:bg-surface-2'
              }`}
            >
              {isActive && (
                <div className="absolute inset-y-0 left-0 w-1 rounded-l-md bg-accent" />
              )}
              <div className="ml-1 flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[session.status]}`}
                  />
                  <span className="truncate text-sm font-medium text-fg">
                    {session.title}
                  </span>
                </div>
                <div className="flex items-center gap-1 px-4 text-xs text-fg-muted">
                  <span className="truncate">
                    {formatCwdBasename(session.cwd)}
                  </span>
                  <span>•</span>
                  <span className="shrink-0">{session.model}</span>
                </div>
              </div>
              <div className="ml-2 flex shrink-0 flex-col items-end gap-0.5 font-mono text-xs text-fg-muted">
                <span>{formatTokens(session.tokens)}</span>
                <span className="text-fg-muted opacity-75">
                  {getRelativeTime(session.updatedAt)}
                </span>
              </div>
            </button>
          </li>
        )
      })}
      </ul>
    </div>
  )
}
