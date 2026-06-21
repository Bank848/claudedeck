import { useRef, useState } from 'react'
import { Popover, usePopover } from '../Pill'
import { formatResetsIn, type UsageWindow } from '@/state/usage'
import { useUsageFeed } from '@/state/useUsageFeed'

/** Claude context-window size (tokens) used as the ring denominator. */
const CONTEXT_LIMIT = 200_000

function pct(used: number, limit: number): number {
  return Math.min(100, Math.round((used / limit) * 100))
}

interface UsagePillProps {
  /** Cumulative tokens for the active session. */
  tokens: number
}

export function UsagePill({ tokens }: UsagePillProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)
  const { state } = useUsageFeed()

  const ctxPct = pct(tokens, CONTEXT_LIMIT)
  const ring = `conic-gradient(rgb(var(--accent)) ${ctxPct * 3.6}deg, rgb(var(--surface-2)) 0deg)`
  const now = new Date()
  const planRows: { label: string; window: UsageWindow }[] =
    state.status === 'ready'
      ? [
          ...(state.data.fiveHour ? [{ label: '5-hour limit', window: state.data.fiveHour }] : []),
          ...(state.data.sevenDay ? [{ label: 'Weekly limit', window: state.data.sevenDay }] : []),
        ]
      : []

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Context window ${ctxPct} percent used. Open usage details.`}
        title={`Context: ${ctxPct}%`}
        className="flex h-6 w-6 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: ring }}>
          <span className="h-2.5 w-2.5 rounded-full bg-surface" />
        </span>
      </button>
      {open && (
        <Popover role="dialog" ariaLabel="Usage" width="w-72" align="right">
          <div className="space-y-3 p-3 text-xs">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-fg">Context window</span>
                <span className="font-mono text-fg-muted">
                  {tokens.toLocaleString()} / {CONTEXT_LIMIT.toLocaleString()} ({ctxPct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${ctxPct}%` }} />
              </div>
            </div>
            <div className="space-y-1.5 border-t border-border pt-2">
              <span className="font-medium text-fg">Plan usage</span>
              {state.status === 'loading' && (
                <p className="text-fg-muted">Loading…</p>
              )}
              {state.status === 'error' && (
                <p className="text-fg-muted">{state.error}</p>
              )}
              {state.status === 'ready' && planRows.length === 0 && (
                <p className="text-fg-muted">No active rate-limit windows.</p>
              )}
              {planRows.map(({ label, window: w }) => (
                <div key={label} className="flex items-center justify-between text-fg-muted">
                  <span>{label}</span>
                  <span className="font-mono">
                    {Math.round(w.utilization)}% · resets {formatResetsIn(w.resetsAt, now)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </div>
  )
}
