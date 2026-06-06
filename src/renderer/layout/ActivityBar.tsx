import {
  MessageSquare,
  FolderGit2,
  KanbanSquare,
  GitCompare,
  Sparkles,
  Gauge,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import type { ActivityId } from '@/mock/fixtures'

interface ActivityItem {
  id: ActivityId
  label: string
  icon: LucideIcon
}

const TOP_ITEMS: ActivityItem[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'sessions', label: 'Sessions', icon: FolderGit2 },
  { id: 'tasks', label: 'Tasks', icon: KanbanSquare },
  { id: 'changes', label: 'Changes', icon: GitCompare },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'usage', label: 'Usage', icon: Gauge },
]

const BOTTOM_ITEMS: ActivityItem[] = [{ id: 'settings', label: 'Settings', icon: Settings }]

interface ActivityBarProps {
  activity: ActivityId
  onChange: (id: ActivityId) => void
}

export function ActivityBar({ activity, onChange }: ActivityBarProps): JSX.Element {
  return (
    <nav
      className="flex shrink-0 flex-col items-center justify-between border-r border-border bg-surface py-2"
      style={{ width: 'var(--activitybar-w)' }}
      aria-label="Primary"
    >
      <div className="flex flex-col items-center gap-1">
        {TOP_ITEMS.map((item) => (
          <ActivityButton key={item.id} item={item} active={activity === item.id} onChange={onChange} />
        ))}
      </div>
      <div className="flex flex-col items-center gap-1">
        {BOTTOM_ITEMS.map((item) => (
          <ActivityButton key={item.id} item={item} active={activity === item.id} onChange={onChange} />
        ))}
      </div>
    </nav>
  )
}

function ActivityButton({
  item,
  active,
  onChange,
}: {
  item: ActivityItem
  active: boolean
  onChange: (id: ActivityId) => void
}): JSX.Element {
  const Icon = item.icon
  return (
    <button
      type="button"
      title={item.label}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      onClick={() => onChange(item.id)}
      className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
        active ? 'text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
      )}
      <Icon size={20} />
    </button>
  )
}
