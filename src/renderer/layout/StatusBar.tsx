import { GitBranch, Cpu, Coins, FolderOpen, Dot } from 'lucide-react'
import type { Session } from '@/mock/fixtures'
import type { PermissionMode } from '@/cli/types'

interface StatusBarProps {
  session: Session
  live: boolean
  claudeAvailable: boolean
  permissionMode: PermissionMode
  onToggleLive: () => void
  onChangePermission: (mode: PermissionMode) => void
}

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  plan: 'Plan (read-only)',
  acceptEdits: 'Accept edits',
  bypassPermissions: 'Bypass',
  default: 'Default',
}

export function StatusBar({
  session, live, claudeAvailable, permissionMode, onToggleLive, onChangePermission,
}: StatusBarProps): JSX.Element {
  const connected = session.status !== 'error'
  return (
    <footer
      className="flex shrink-0 items-center justify-between border-t border-border bg-surface px-3 text-xs text-fg-muted"
      style={{ height: 'var(--statusbar-h)' }}
    >
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <Dot size={18} className={connected ? 'text-success' : 'text-destructive'} strokeWidth={6} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <span className="flex items-center gap-1.5">
          <GitBranch size={12} />
          {session.cwd.split('/').pop()}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Live / Mock toggle */}
        <button
          type="button"
          onClick={onToggleLive}
          disabled={!claudeAvailable}
          aria-pressed={live}
          aria-label={live ? 'Live mode — using the real claude CLI. Click to switch to mock.' : 'Mock mode. Click to go live with the real claude CLI.'}
          title={claudeAvailable ? (live ? 'Live (real claude CLI)' : 'Mock data') : 'claude CLI not detected'}
          className={`rounded px-2 py-0.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            live ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-fg-muted hover:text-fg'
          } ${claudeAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
        >
          {live ? '● Live' : '○ Mock'}
        </button>

        {/* Permission mode */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Permission mode</span>
          <select
            value={permissionMode}
            onChange={(e) => onChangePermission(e.target.value as PermissionMode)}
            aria-label="claude permission mode"
            className="rounded border border-border bg-bg px-1.5 py-0.5 text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((m) => (
              <option key={m} value={m}>{PERMISSION_LABELS[m]}</option>
            ))}
          </select>
        </label>

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
