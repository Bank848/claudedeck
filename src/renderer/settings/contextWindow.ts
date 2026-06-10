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

/** Known context tiers, ascending. Claude Code runs Opus on the 1M-token beta. */
const CONTEXT_TIERS = [200_000, 1_000_000]

/**
 * Effective window for a model. When `contextTokens` is supplied and exceeds the
 * model's base window, the session is provably on a larger tier (the API would
 * reject a prompt bigger than its window), so promote the denominator to the
 * smallest tier that fits. Without `contextTokens`, returns the base window.
 */
export function windowFor(model: string, contextTokens = 0): number {
  const base = CONTEXT_WINDOW[model] ?? DEFAULT_WINDOW
  if (contextTokens <= base) return base
  return CONTEXT_TIERS.find((t) => t >= contextTokens) ?? CONTEXT_TIERS[CONTEXT_TIERS.length - 1]
}

export function contextPct(contextTokens: number, model: string, observed = contextTokens): number {
  return contextTokens / windowFor(model, observed)
}

/** True only on an upward crossing of the 80% line (prev below, next at/above). */
export function crossed80(prevPct: number, nextPct: number): boolean {
  return prevPct < CONTEXT_THRESHOLD && nextPct >= CONTEXT_THRESHOLD
}
