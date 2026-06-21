import type { RealUsage, UsageWindow } from './usage'

// `utilization` from the OAuth usage feed is already a 0–100 percentage (UsageView's
// barColor/width/Math.round math treats it that way and the page renders correctly),
// so the near-limit threshold is 80, NOT 0.8.
export const WARN_THRESHOLD = 80

/** The reset timestamp we last warned for, per window. null = never warned. */
export interface WarnState {
  fiveHour: string | null
  sevenDay: string | null
}

export const initialWarnState: WarnState = { fiveHour: null, sevenDay: null }

export type WarnKey = 'fiveHour' | 'sevenDay'

export interface WarnSignal {
  key: WarnKey
  window: UsageWindow
}

/**
 * Decide which windows newly crossed the warning threshold and have not yet been
 * warned for their current reset cycle. Pure: returns the signals to fire plus the
 * next dedupe state. Warn at most once per window per reset cycle (keyed on resetsAt),
 * so a window that hovers above 80% does not re-notify on every poll — only when it
 * resets (resetsAt changes) does a fresh warning become eligible.
 */
export function computeWarnings(usage: RealUsage, prev: WarnState): { signals: WarnSignal[]; next: WarnState } {
  const signals: WarnSignal[] = []
  const next: WarnState = { ...prev }
  const check = (key: WarnKey, w: UsageWindow | null): void => {
    if (!w || w.utilization < WARN_THRESHOLD) return
    if (prev[key] === w.resetsAt) return // already warned for this exact reset cycle
    signals.push({ key, window: w })
    next[key] = w.resetsAt
  }
  check('fiveHour', usage.fiveHour)
  check('sevenDay', usage.sevenDay)
  return { signals, next }
}

/** Human label for a window key, used in banners and notification text. */
export function warnLabel(key: WarnKey): string {
  return key === 'fiveHour' ? '5-hour limit' : 'Weekly limit'
}
