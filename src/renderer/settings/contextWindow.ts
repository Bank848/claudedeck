import type { TurnUsage } from '@/cli/types'

/** Effective context window per model id (ClaudeDeck picker ids). Default 200k. */
const CONTEXT_WINDOW: Record<string, number> = {
  'opus-4-8': 200_000,
  'sonnet-4-6': 200_000,
  'haiku-4-5': 200_000,
}
export const DEFAULT_WINDOW = 200_000
export const CONTEXT_THRESHOLD = 0.8

/** Real context occupancy: cache tokens count too (verified against claude JSONL). */
export function contextTokensOf(u: TurnUsage): number {
  return u.input + u.cacheRead + u.cacheCreation
}

export function windowFor(model: string): number {
  return CONTEXT_WINDOW[model] ?? DEFAULT_WINDOW
}

export function contextPct(contextTokens: number, model: string): number {
  return contextTokens / windowFor(model)
}

/** True only on an upward crossing of the 80% line (prev below, next at/above). */
export function crossed80(prevPct: number, nextPct: number): boolean {
  return prevPct < CONTEXT_THRESHOLD && nextPct >= CONTEXT_THRESHOLD
}
