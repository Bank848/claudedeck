import { Gauge, Clock, CalendarDays, Sparkles, Bot } from 'lucide-react'
import { USAGE, type Provider, type ProviderUsage, type UsageWindow } from '@/mock/fixtures'

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

function pct(used: number, limit: number): number {
  return Math.min(100, Math.round((used / limit) * 100))
}

function barColor(p: number): string {
  if (p >= 90) return 'bg-destructive'
  if (p >= 70) return 'bg-accent'
  return 'bg-success'
}

export default function UsageView(): JSX.Element {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-1 flex items-center gap-2 text-2xl font-semibold text-fg">
          <Gauge size={22} className="text-accent" />
          Usage
        </h1>
        <p className="mb-6 text-sm text-fg-muted">
          Token consumption and rolling limits, split by provider. {fmt(USAGE.today)} tokens used
          today.
        </p>

        <div className="space-y-8">
          {USAGE.providers.map((p) => (
            <ProviderBlock key={p.provider} data={p} />
          ))}
        </div>

        <p className="mt-6 text-xs text-fg-muted">
          Limits and figures are illustrative (Phase 1 mock data).
        </p>
      </div>
    </div>
  )
}

function ProviderBlock({ data }: { data: ProviderUsage }): JSX.Element {
  const maxModel = Math.max(...data.models.map((m) => m.tokens), 1)
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
          <ProviderIcon provider={data.provider} size={18} />
          {data.label}
        </h2>
        <span className="text-xs text-fg-muted">
          {fmt(data.total)} tokens <span className="opacity-60">this week</span>
        </span>
      </div>

      {/* Limit windows */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {data.windows.map((w) => (
          <WindowCard key={w.id} window={w} />
        ))}
      </div>

      {/* Per-model bars */}
      <div className="space-y-2.5">
        {data.models.map((m) => (
          <div key={m.label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-fg">{m.label}</span>
              <span className="tabular-nums text-fg-muted">{fmt(m.tokens)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg">
              <div
                className={`h-full rounded-full ${data.provider === 'codex' ? 'bg-emerald-400' : 'bg-accent'}`}
                style={{ width: `${Math.max(3, Math.round((m.tokens / maxModel) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function WindowCard({ window: w }: { window: UsageWindow }): JSX.Element {
  const p = pct(w.used, w.limit)
  const Icon = w.id.includes('5h') ? Clock : CalendarDays
  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
          <Icon size={13} className="text-fg-muted" />
          {w.label}
        </span>
        <span className="text-xs text-fg-muted">resets in {w.resetsIn}</span>
      </div>
      <div className="mb-1.5 flex items-end justify-between">
        <span className="text-xl font-semibold tabular-nums text-fg">{p}%</span>
        <span className="text-xs tabular-nums text-fg-muted">
          {fmt(w.used)} / {fmt(w.limit)}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={p}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={w.label}
      >
        <div className={`h-full rounded-full ${barColor(p)}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}

function ProviderIcon({ provider, size = 13 }: { provider: Provider; size?: number }): JSX.Element {
  return provider === 'claude' ? (
    <Sparkles size={size} className="text-accent" />
  ) : (
    <Bot size={size} className="text-emerald-400" />
  )
}
