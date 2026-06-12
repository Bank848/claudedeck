import {
  MessageSquare,
  FolderGit2,
  KanbanSquare,
  GitCompare,
  Sparkles,
  Gauge,
  BookOpen,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import type { ActivityId } from '@/mock/fixtures'
import { VIEW_NAMES } from '@/settings/prewarmPhrases'
import { useSettings } from '@/settings/SettingsContext'
import { resolveLang } from '@/settings/speech'

interface ActivityItem {
  id: ActivityId
  icon: LucideIcon
}

const TOP_ITEMS: ActivityItem[] = [
  { id: 'chat', icon: MessageSquare },
  { id: 'sessions', icon: FolderGit2 },
  { id: 'tasks', icon: KanbanSquare },
  { id: 'changes', icon: GitCompare },
  { id: 'skills', icon: Sparkles },
  { id: 'usage', icon: Gauge },
  { id: 'guide', icon: BookOpen },
]

const BOTTOM_ITEMS: ActivityItem[] = [{ id: 'settings', icon: Settings }]

interface ActivityBarProps {
  activity: ActivityId
  onChange: (id: ActivityId) => void
}

export function ActivityBar({ activity, onChange }: ActivityBarProps): JSX.Element {
  // aria-labels share VIEW_NAMES with the TTS announcements (no drift): a Thai
  // screen-reader user hears the same view name from NVDA and from Miku.
  const { settings } = useSettings()
  const lang = resolveLang(settings.voiceLang).short === 'th' ? 'th' : 'en'
  return (
    <nav
      className="flex shrink-0 flex-col items-center justify-between border-r border-border bg-surface py-2"
      style={{ width: 'var(--activitybar-w)' }}
      aria-label="Primary"
    >
      <div className="flex flex-col items-center gap-1">
        {TOP_ITEMS.map((item) => (
          <ActivityButton key={item.id} item={item} lang={lang} active={activity === item.id} onChange={onChange} />
        ))}
      </div>
      <div className="flex flex-col items-center gap-1">
        {BOTTOM_ITEMS.map((item) => (
          <ActivityButton key={item.id} item={item} lang={lang} active={activity === item.id} onChange={onChange} />
        ))}
      </div>
    </nav>
  )
}

function ActivityButton({
  item,
  lang,
  active,
  onChange,
}: {
  item: ActivityItem
  lang: 'th' | 'en'
  active: boolean
  onChange: (id: ActivityId) => void
}): JSX.Element {
  const Icon = item.icon
  const label = VIEW_NAMES[item.id][lang]
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
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
