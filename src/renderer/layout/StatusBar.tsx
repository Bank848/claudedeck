import { Cpu, Coins, Dot } from 'lucide-react'
import type { Session } from '@/mock/fixtures'
import type { PermissionMode } from '@/cli/types'
import { windowFor } from '@/settings/contextWindow'
import { FooterPickers } from './FooterPickers'

interface StatusBarProps {
  session: Session
  loggedIn: boolean
  cliAvailable: boolean
  permissionMode: PermissionMode
  onConnect: () => void
  onDisconnect: () => void
  onSetCwd: (path: string) => void
  onAnnounce: (msg: string) => void
}

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  plan: 'Plan (read-only)',
  acceptEdits: 'Accept edits',
  bypassPermissions: 'Bypass',
  default: 'Default',
  auto: 'Auto',
  dontAsk: "Don't ask",
}

export function StatusBar({
  session, loggedIn, cliAvailable, permissionMode, onConnect, onDisconnect, onSetCwd, onAnnounce,
}: StatusBarProps): JSX.Element {
  const ready = session.status !== 'error'
  return (
    <footer
      className="flex shrink-0 items-center justify-between border-t border-border bg-surface px-3 text-xs text-fg-muted"
      style={{ height: 'var(--statusbar-h)' }}
    >
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Dot size={18} className={ready ? 'text-success' : 'text-destructive'} strokeWidth={6} />
          {ready ? 'Ready' : 'Error'}
        </span>
        <FooterPickers cwd={session.cwd} onSetCwd={onSetCwd} onAnnounce={onAnnounce} />
      </div>

      <div className="flex items-center gap-3">
        {/* Connect / account chip (login when out, logout when in) */}
        <button
          type="button"
          onClick={loggedIn ? onDisconnect : onConnect}
          disabled={!cliAvailable}
          aria-label={loggedIn ? 'Connected to your Claude account. Click to disconnect.' : 'Not connected. Click to connect your Claude account.'}
          title={cliAvailable ? (loggedIn ? 'Connected — click to disconnect' : 'Connect your Claude account') : 'claude CLI not detected'}
          className={`rounded px-2 py-0.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            loggedIn ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-fg-muted hover:text-fg'
          } ${cliAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
        >
          {loggedIn ? '● Connected' : '○ Connect'}
        </button>

        {/* Permission mode (read-only mirror; change it in the composer) */}
        <span className="flex items-center gap-1.5" title="Permission mode — change it in the composer">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-fg-muted">{PERMISSION_LABELS[permissionMode]}</span>
        </span>

        <span className="flex items-center gap-1.5">
          <Cpu size={12} />
          {session.model}
        </span>
        <span className="flex items-center gap-1.5 font-mono">
          <Coins size={12} />
          {session.tokens.toLocaleString()} tok
        </span>
        {typeof session.contextTokens === 'number' && session.contextTokens > 0 && (
          <span className="flex items-center gap-1.5 font-mono" title="Context window used">
            {Math.round((session.contextTokens / windowFor(session.model)) * 100)}% ctx
          </span>
        )}
      </div>
    </footer>
  )
}
