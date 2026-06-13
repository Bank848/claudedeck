import { KANBAN_COLUMNS, SKILLS, type ActivityId, type Session } from '@/mock/fixtures'
import SessionsPanel from '@/views/sessions/SessionsPanel'

interface SidebarProps {
  activity: ActivityId
  sessions: Session[]
  activeSessionId: string
  onSelectSession: (id: string) => void
  onFork?: () => void
  onNew?: () => void
  onNewInFolder?: (cwd: string) => void
  onPin?: (id: string) => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
}

const TITLES: Record<ActivityId, string> = {
  chat: 'Sessions',
  sessions: 'Sessions',
  tasks: 'Boards',
  changes: 'Source Control',
  skills: 'Skill Categories',
  usage: 'Usage',
  guide: 'Guide',
  settings: 'Settings',
}

export function Sidebar({
  activity,
  sessions,
  activeSessionId,
  onSelectSession,
  onFork,
  onNew,
  onNewInFolder,
  onPin,
  onArchive,
  onUnarchive,
  onDelete,
  onRename,
}: SidebarProps): JSX.Element {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-surface">
      <div className="flex h-9 shrink-0 items-center px-3 text-xs font-medium text-fg-muted">
        {TITLES[activity]}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarBody
          activity={activity}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={onSelectSession}
          onFork={onFork}
          onNew={onNew}
          onNewInFolder={onNewInFolder}
          onPin={onPin}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onDelete={onDelete}
          onRename={onRename}
        />
      </div>
    </aside>
  )
}

function SidebarBody({
  activity,
  sessions,
  activeSessionId,
  onSelectSession,
  onFork,
  onNew,
  onNewInFolder,
  onPin,
  onArchive,
  onUnarchive,
  onDelete,
  onRename,
}: SidebarProps): JSX.Element {
  if (activity === 'chat' || activity === 'sessions') {
    return (
      <SessionsPanel
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={onSelectSession}
        onFork={onFork}
        onNew={onNew}
        onNewInFolder={onNewInFolder}
        onPin={onPin}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDelete={onDelete}
        onRename={onRename}
      />
    )
  }

  if (activity === 'tasks') {
    return (
      <ul className="px-2 py-1 text-sm">
        {KANBAN_COLUMNS.map((c) => (
          <li key={c.id} className="rounded px-2 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg">
            {c.title}
          </li>
        ))}
      </ul>
    )
  }

  if (activity === 'skills') {
    const categories = Array.from(new Set(SKILLS.map((s) => s.category)))
    return (
      <ul className="px-2 py-1 text-sm">
        {categories.map((cat) => (
          <li key={cat} className="rounded px-2 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg">
            {cat}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <p className="px-3 py-2 text-xs text-fg-muted">
      Contextual panel for “{TITLES[activity]}”.
    </p>
  )
}
