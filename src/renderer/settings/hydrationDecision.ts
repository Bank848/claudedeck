/**
 * Decide what to do with the result of the disk settings load on boot.
 *
 * The bug (#4): `settings:load` returned `null` for BOTH a genuine first-run
 * (no file) AND a transient read failure (handler threw → safeHandle fallback).
 * Treated as first-run, a failure let the renderer seed/persist over an intact
 * file — risking a reset of a blind user's carefully-tuned voice settings.
 *
 * The main process now returns a distinct error sentinel `{ __error: true }` on
 * load failure (genuine-empty stays `null`). This helper encodes the policy:
 * on error, DON'T apply, DON'T seed, and DON'T mark hydrated — leaving hydration
 * incomplete blocks the persist effect for the session, so the on-disk file is
 * never overwritten by a load we couldn't trust.
 */
export type LoadResult = Record<string, unknown> | null | { __error: boolean }

export function isLoadError(r: LoadResult): r is { __error: true } {
  return !!r && typeof r === 'object' && (r as { __error?: unknown }).__error === true
}

export interface HydrationDecision {
  /** Settings object to merge over defaults, or null. */
  applyStored: Record<string, unknown> | null
  /** Seed disk from the in-memory/localStorage cache (first-run migration). */
  seedDisk: boolean
  /** Mark hydration complete. false = block disk writes this session (load failed). */
  hydrated: boolean
}

export function decideHydration(loaded: LoadResult, hasLocalCache: boolean): HydrationDecision {
  if (isLoadError(loaded)) {
    return { applyStored: null, seedDisk: false, hydrated: false }
  }
  if (loaded) {
    return { applyStored: loaded as Record<string, unknown>, seedDisk: false, hydrated: true }
  }
  // Genuine empty (no file): only seed disk if there's a cache worth migrating.
  return { applyStored: null, seedDisk: hasLocalCache, hydrated: true }
}
