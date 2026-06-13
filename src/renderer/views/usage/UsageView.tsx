import { useState, useEffect, useCallback } from 'react'
import { Gauge, Clock, CalendarDays, RefreshCw } from 'lucide-react'
import { formatResetsIn, type RealUsage, type UsageWindow } from '@/state/usage'

function barColor(p: number): string {
  if (p >= 90) return 'bg-destructive'
  if (p >= 70) return 'bg-accent'
  return 'bg-success'
}

type State =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: RealUsage }

export default function UsageView(): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })

  const load = useCallback(() => {
    setState({ status: 'loading' })
    let live = true
    window.claudedeck.usage.fetch().then((r) => {
      if (!live) return
      setState(r.ok ? { status: 'ready', data: r.usage } : { status: 'error', error: r.error })
    })
    return () => { live = false }
  }, [])

  useEffect(() => load(), [load])

  const now = new Date()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="mb-1 flex items-center gap-2 text-2xl font-semibold text-fg">
              <Gauge size={22} className="text-accent" />
              Usage
            </h1>
            <p className="text-sm text-fg-muted">
              Rate limit utilization and reset times from your Claude subscription.
              {state.status === 'ready' && state.data.subscriptionType && (
                <span className="ml-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg">
                  {state.data.subscriptionType}
                  {state.data.rateLimitTier ? ` · ${state.data.rateLimitTier}` : ''}
                </span>
              )}
            </p>
          </div>
          {state.status !== 'loading' && (
            <button
              onClick={load}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
              title="Refresh usage"
            >
              <RefreshCw size={13} />
              Refresh
            </button>
          )}
        </div>

        {state.status === 'loading' && (
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-surface" />
            ))}
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-xl border border-border bg-surface p-6 text-center">
            <p className="mb-3 text-sm text-fg-muted">{state.error}</p>
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
            >
              <RefreshCw size={13} />
              Retry
            </button>
          </div>
        )}

        {state.status === 'ready' && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {state.data.fiveHour && (
                <WindowCard
                  label="5-hour limit"
                  icon="clock"
                  window={state.data.fiveHour}
                  now={now}
                />
              )}
              {state.data.sevenDay && (
                <WindowCard
                  label="Weekly limit"
                  icon="calendar"
                  window={state.data.sevenDay}
                  now={now}
                />
              )}
            </div>

            {(state.data.sevenDayOpus || state.data.sevenDaySonnet) && (
              <section className="rounded-xl border border-border bg-surface p-4">
                <h2 className="mb-3 text-sm font-semibold text-fg">Per-model (this week)</h2>
                <div className="space-y-3">
                  {state.data.sevenDayOpus && (
                    <ModelBar label="Claude Opus" window={state.data.sevenDayOpus} />
                  )}
                  {state.data.sevenDaySonnet && (
                    <ModelBar label="Claude Sonnet" window={state.data.sevenDaySonnet} />
                  )}
                </div>
              </section>
            )}

            {state.data.extraUsageEnabled && (
              <p className="text-xs text-fg-muted">
                <span className="mr-1 inline-block rounded-full bg-accent/20 px-2 py-0.5 text-accent">
                  Extra usage on
                </span>
                Additional capacity beyond the standard limits is active.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function WindowCard({
  label,
  icon,
  window: w,
  now,
}: {
  label: string
  icon: 'clock' | 'calendar'
  window: UsageWindow
  now: Date
}): JSX.Element {
  const p = Math.round(w.utilization)
  const Icon = icon === 'clock' ? Clock : CalendarDays
  const resetsIn = formatResetsIn(w.resetsAt, now)
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <Icon size={14} className="text-fg-muted" />
          {label}
        </span>
        <span className="text-xs text-fg-muted">resets in {resetsIn}</span>
      </div>
      <div className="mb-2">
        <span className="text-2xl font-semibold tabular-nums text-fg">{p}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={p}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={`h-full rounded-full ${barColor(p)}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}

function ModelBar({ label, window: w }: { label: string; window: UsageWindow }): JSX.Element {
  const p = Math.round(w.utilization)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-fg">{label}</span>
        <span className="tabular-nums text-fg-muted">{p}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-bg"
        role="progressbar"
        aria-valuenow={p}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full ${barColor(p)}`}
          style={{ width: `${Math.max(3, p)}%` }}
        />
      </div>
    </div>
  )
}
