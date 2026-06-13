import { useMemo, useState } from 'react'
import { Plus, GitBranch, Pin, Archive, ArchiveRestore, Trash2, Search, ChevronDown, ChevronRight } from 'lucide-react'
import { type Session, type SessionStatus } from '@/mock/fixtures'
import { groupSessions, recentSessions } from '@/state/sessionGroups'

/** How many recently-touched sessions the "Recent" strip surfaces. */
const RECENT_LIMIT = 5

const STATUS_DOT: Record<SessionStatus, string> = {
  active: 'bg-accent', running: 'bg-success', idle: 'bg-fg-muted', error: 'bg-destructive',
}

function getRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(0)}K`
  return `${(tokens / 1000000).toFixed(1)}M`
}

interface SessionsPanelProps {
  sessions: Session[]
  activeSessionId: string
  onSelect: (id: string) => void
  onFork?: () => void
  onNew?: () => void
  onNewInFolder?: (cwd: string) => void
  onPin?: (id: string) => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
}

export default function SessionsPanel(props: SessionsPanelProps): JSX.Element {
  const { sessions, activeSessionId, onSelect, onFork, onNew } = props
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [recentCollapsed, setRecentCollapsed] = useState(false)

  const groups = useMemo(
    () => groupSessions(sessions, { query, showArchived }),
    [sessions, query, showArchived],
  )
  const archivedCount = useMemo(() => sessions.filter((s) => s.archived).length, [sessions])
  const activeCount = useMemo(() => sessions.filter((s) => !s.archived).length, [sessions])

  // The Recent strip only earns its space in the default view once there are
  // more active sessions than it shows — i.e. some are already buried in folders.
  // It is hidden while searching (results are already a flat, ranked view) and
  // in the archive.
  const recent = useMemo(
    () => (!query && !showArchived && activeCount > RECENT_LIMIT ? recentSessions(sessions, RECENT_LIMIT) : []),
    [sessions, query, showArchived, activeCount],
  )

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

      {/* Search */}
      <div className="mx-2 mb-1 mt-1 flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 focus-within:border-accent">
        <Search size={13} className="shrink-0 text-fg-muted" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={showArchived ? 'Search archive…' : 'Search sessions…'}
          aria-label="Search sessions by title or project"
          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
        />
      </div>

      {/* Recent — flat, cross-folder shortcut so freshly-used sessions don't
          sink under crowded folders. */}
      {recent.length > 0 && (
        <nav aria-label="Recent sessions" className="px-1 pb-1 pt-1">
          <section role="group" aria-label="Recent">
            <h3 className="px-1">
              <button
                type="button"
                onClick={() => setRecentCollapsed((v) => !v)}
                aria-expanded={!recentCollapsed}
                className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-muted transition-colors hover:text-fg"
              >
                {recentCollapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                <span>Recent</span>
                <span className="ml-auto font-normal opacity-60">{recent.length}</span>
              </button>
            </h3>
            {!recentCollapsed && (
              <ul aria-label="Recent sessions" className="mb-1 space-y-0.5 px-1">
                {recent.map((session) => (
                  <SessionRow
                    key={`recent-${session.id}`}
                    session={session}
                    active={session.id === activeSessionId}
                    showArchived={false}
                    onSelect={onSelect}
                    onPin={props.onPin}
                    onArchive={props.onArchive}
                    onUnarchive={props.onUnarchive}
                    onDelete={props.onDelete}
                    onRename={props.onRename}
                  />
                ))}
              </ul>
            )}
          </section>
          <div className="mx-1 mt-1 border-t border-border" aria-hidden="true" />
        </nav>
      )}

      {groups.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-fg-muted">
          {showArchived ? 'Archive is empty' : query ? 'No matches' : 'No sessions yet'}
        </p>
      ) : (
        <nav aria-label="Session library" className="px-1 py-1">
          {groups.map((g) => {
            const isCollapsed = collapsed[g.project] ?? false
            return (
              <section key={g.project} role="group" aria-label={`Project ${g.project}`}>
                <h3 className="group/hdr flex items-center px-1">
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.project]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    title={g.cwd}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-muted transition-colors hover:text-fg"
                  >
                    {isCollapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                    <span className="truncate">{g.project}</span>
                    <span className="ml-auto font-normal opacity-60">{g.sessions.length}</span>
                  </button>
                  {props.onNewInFolder && (
                    <button
                      type="button"
                      onClick={() => props.onNewInFolder?.(g.cwd)}
                      aria-label={`New session in ${g.project}`}
                      title={`New session in ${g.cwd}`}
                      className="ml-0.5 shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-fg focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover/hdr:opacity-100"
                    >
                      <Plus size={12} aria-hidden="true" />
                    </button>
                  )}
                </h3>
                {!isCollapsed && (
                  <ul aria-label={`${g.project} sessions`} className="mb-1 space-y-0.5 px-1">
                    {g.sessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        active={session.id === activeSessionId}
                        showArchived={showArchived}
                        onSelect={onSelect}
                        onPin={props.onPin}
                        onArchive={props.onArchive}
                        onUnarchive={props.onUnarchive}
                        onDelete={props.onDelete}
                        onRename={props.onRename}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </nav>
      )}

      {/* Archive toggle */}
      {(archivedCount > 0 || showArchived) && (
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          aria-pressed={showArchived}
          className="mx-2 mb-2 mt-1 flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-left text-xs text-fg-muted transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Archive size={13} className="shrink-0" aria-hidden="true" />
          <span>{showArchived ? 'Back to active sessions' : `Archive (${archivedCount})`}</span>
        </button>
      )}
    </div>
  )
}

function SessionRow({
  session, active, showArchived, onSelect, onPin, onArchive, onUnarchive, onDelete, onRename,
}: {
  session: Session
  active: boolean
  showArchived: boolean
  onSelect: (id: string) => void
  onPin?: (id: string) => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
}): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const openTab = session.open ? 'open' : 'idle'
  const label = `${session.title}, ${openTab}, ${session.model}, ${getRelativeTime(session.updatedAt)}${session.pinned ? ', pinned' : ''}`

  const commitRename = (): void => {
    const t = draft.trim()
    if (t && t !== session.title) onRename?.(session.id, t)
    setRenaming(false)
  }

  return (
    <li className="group relative">
      {confirmingDelete ? (
        <div
          role="alertdialog"
          aria-label={`Delete ${session.title} permanently?`}
          className="mx-1 flex items-center gap-2 rounded-md border border-destructive bg-bg px-2 py-1.5 text-xs"
        >
          <span className="min-w-0 flex-1 truncate text-fg">Delete “{session.title}” forever?</span>
          <button
            type="button"
            autoFocus
            onClick={() => { setConfirmingDelete(false); onDelete?.(session.id) }}
            className="shrink-0 rounded bg-destructive px-2 py-0.5 font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="shrink-0 rounded border border-border px-2 py-0.5 text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancel
          </button>
        </div>
      ) : renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') { setDraft(session.title); setRenaming(false) }
          }}
          aria-label={`Rename ${session.title}`}
          className="mx-1 w-[calc(100%-0.5rem)] rounded border border-accent bg-bg px-2 py-1 text-sm text-fg outline-none"
        />
      ) : (
        <div className={`flex items-center rounded-md transition-colors ${active ? 'bg-surface-2' : 'hover:bg-surface-2'}`}>
          {active && <div className="absolute inset-y-0 left-0 w-1 rounded-l-md bg-accent" aria-hidden="true" />}
          <button
            type="button"
            onClick={() => onSelect(session.id)}
            onDoubleClick={() => onRename && setRenaming(true)}
            aria-label={label}
            aria-current={active ? 'true' : undefined}
            className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left"
          >
            <div className="flex items-center gap-2">
              {session.pinned && <Pin size={10} className="shrink-0 text-accent" aria-hidden="true" />}
              <span className={`h-2 w-2 shrink-0 rounded-full ${session.open ? STATUS_DOT[session.status] : 'bg-transparent ring-1 ring-fg-muted'}`} aria-hidden="true" />
              <span className="truncate text-sm font-medium text-fg">{session.title}</span>
            </div>
            <div className="flex items-center gap-1 pl-4 text-xs text-fg-muted">
              <span className="shrink-0">{session.model}</span>
              <span>•</span>
              <span className="shrink-0 font-mono">{formatTokens(session.tokens)}</span>
              <span>•</span>
              <span className="shrink-0">{getRelativeTime(session.updatedAt)}</span>
            </div>
          </button>

          {/* Row actions — keyboard reachable, revealed on hover/focus */}
          <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {showArchived ? (
              <>
                {onUnarchive && (
                  <button type="button" aria-label={`Restore ${session.title} from archive`} title="Restore"
                    onClick={() => onUnarchive(session.id)}
                    className="rounded p-1 text-fg-muted hover:bg-surface hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <ArchiveRestore size={13} />
                  </button>
                )}
                {onDelete && (
                  <button type="button" aria-label={`Delete ${session.title} permanently`} title="Delete permanently"
                    onClick={() => setConfirmingDelete(true)}
                    className="rounded p-1 text-fg-muted hover:bg-surface hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <Trash2 size={13} />
                  </button>
                )}
              </>
            ) : (
              <>
                {onPin && (
                  <button type="button" aria-label={session.pinned ? `Unpin ${session.title}` : `Pin ${session.title}`} title={session.pinned ? 'Unpin' : 'Pin'}
                    onClick={() => onPin(session.id)}
                    className={`rounded p-1 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${session.pinned ? 'text-accent' : 'text-fg-muted hover:text-fg'}`}>
                    <Pin size={13} />
                  </button>
                )}
                {onRename && (
                  <button type="button" aria-label={`Rename ${session.title}`} title="Rename"
                    onClick={() => setRenaming(true)}
                    className="rounded p-1 text-fg-muted hover:bg-surface hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    {/* pencil glyph via lucide could be added; reuse text for now */}
                    <span aria-hidden="true" className="text-xs">✎</span>
                  </button>
                )}
                {onArchive && (
                  <button type="button" aria-label={`Archive ${session.title}`} title="Archive"
                    onClick={() => onArchive(session.id)}
                    className="rounded p-1 text-fg-muted hover:bg-surface hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <Archive size={13} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
