import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { RealUsage } from './usage'
import { formatResetsIn } from './usage'
import { computeWarnings, warnLabel, initialWarnState, type WarnState } from './usageWarning'

// Poll cadence. A 5-hour window moves slowly enough that 5 minutes is plenty, and it
// keeps the near-limit warning reasonably timely without hammering the OAuth endpoint.
const POLL_MS = 5 * 60 * 1_000

export type UsageState =
  | { status: 'loading' }
  | { status: 'error'; error: string; lastUpdated?: Date }
  | { status: 'ready'; data: RealUsage; lastUpdated: Date }

interface UsageFeedValue {
  state: UsageState
  refresh: () => void
}

const UsageFeedContext = createContext<UsageFeedValue | null>(null)

/**
 * Single source of truth for the real OAuth usage feed, shared by the Usage page and
 * the header pill so they agree and do not double-request. Mounted once at app root so
 * the near-limit warning fires regardless of which view is open.
 */
export function UsageFeedProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<UsageState>({ status: 'loading' })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const aliveRef = useRef(true)
  const warnRef = useRef<WarnState>(initialWarnState)

  const load = useCallback((silent = false) => {
    if (!silent) setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }))
    void window.claudedeck.usage.fetch().then((r) => {
      if (!aliveRef.current) return
      if (!r.ok) {
        setState({ status: 'error', error: r.error, lastUpdated: new Date() })
        return
      }
      setState({ status: 'ready', data: r.usage, lastUpdated: new Date() })
      // Near-limit warning: notify once per window per reset cycle (BUG 5).
      const { signals, next } = computeWarnings(r.usage, warnRef.current)
      warnRef.current = next
      for (const s of signals) {
        const pctNow = Math.round(s.window.utilization)
        window.claudedeck?.attention?.notify({
          kind: 'limitWarning',
          name: `${warnLabel(s.key)} at ${pctNow}% — resets in ${formatResetsIn(s.window.resetsAt, new Date())}`,
          sessionId: '',
        })
      }
    })
  }, [])

  useEffect(() => {
    aliveRef.current = true
    load()
    timerRef.current = setInterval(() => load(true), POLL_MS)
    return () => {
      aliveRef.current = false
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [load])

  const refresh = useCallback(() => load(), [load])

  return <UsageFeedContext.Provider value={{ state, refresh }}>{children}</UsageFeedContext.Provider>
}

export function useUsageFeed(): UsageFeedValue {
  const ctx = useContext(UsageFeedContext)
  if (!ctx) throw new Error('useUsageFeed must be used within a UsageFeedProvider')
  return ctx
}
