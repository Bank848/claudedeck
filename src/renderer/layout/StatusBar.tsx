import { GitBranch, Cpu, Coins, FolderOpen, Dot } from 'lucide-react'
import type { Session } from '@/mock/fixtures'

interface StatusBarProps {
  session: Session
}

export function StatusBar({ session }: StatusBarProps): JSX.Element {
  const connected = session.status !== 'error'
  return (
    <footer
      className="flex shrink-0 items-center justify-between border-t border-border bg-surface px-3 text-xs text-fg-muted"
      style={{ height: 'var(--statusbar-h)' }}
    >
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <Dot
            size={18}
            className={connected ? 'text-success' : 'text-destructive'}
            strokeWidth={6}
          />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <span className="flex items-center gap-1.5">
          <GitBranch size={12} />
          {session.cwd.split('/').pop()}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <FolderOpen size={12} />
          {session.cwd}
        </span>
        <span className="flex items-center gap-1.5">
          <Cpu size={12} />
          {session.model}
        </span>
        <span className="flex items-center gap-1.5 font-mono">
          <Coins size={12} />
          {session.tokens.toLocaleString()} tok
        </span>
      </div>
    </footer>
  )
}
