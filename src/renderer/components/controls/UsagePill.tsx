import { useRef, useState } from 'react'
import { USAGE } from '@/mock/fixtures'
import { Popover, usePopover } from '../Pill'

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

  const ctxPct = pct(tokens, CONTEXT_LIMIT)
  const ring = `conic-gradient(rgb(var(--accent)) ${ctxPct * 3.6}deg, rgb(var(--surface-2)) 0deg)`
  const claude = USAGE.providers.find((p) => p.provider === 'claude')

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
            {claude && (
              <div className="space-y-1.5 border-t border-border pt-2">
                <span className="font-medium text-fg">Plan usage</span>
                {claude.windows.map((w) => (
                  <div key={w.id} className="flex items-center justify-between text-fg-muted">
                    <span>{w.label}</span>
                    <span className="font-mono">
                      {pct(w.used, w.limit)}% · resets {w.resetsIn}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-fg-muted opacity-70">Plan figures are sample data.</p>
          </div>
        </Popover>
      )}
    </div>
  )
}
