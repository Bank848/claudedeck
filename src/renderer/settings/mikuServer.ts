/** Renderer-side controls for the local Miku voice server (managed by main). */
import { useCallback, useEffect, useRef, useState } from 'react'

function api() {
  return typeof window !== 'undefined' ? window.claudedeck?.miku : undefined
}

export function isMikuManaged(): boolean {
  return !!api()
}

export type MikuPhase = 'stopped' | 'starting' | 'ready' | 'error'

interface UseMikuServer {
  available: boolean
  /** Server lifecycle: stopped → starting (warming up, port not ready) → ready,
   *  or → error (engine failed to load / startup timed out). */
  phase: MikuPhase
  /** True only once /v1/health reports ready:true — safe to send a speech request. */
  running: boolean
  /** Spawned but still booting (pip/torch/model load). */
  starting: boolean
  /** Startup failed (engine load error or 90s timeout) — see the server log. */
  failed: boolean
  hasModel: boolean
  log: string
  start: () => Promise<void>
  stop: () => Promise<void>
  openModels: () => void
  refreshModel: () => void
  downloadModel: (url: string, index?: string) => Promise<{ ok: boolean; error?: string }>
}

export function useMikuServer(): UseMikuServer {
  const [phase, setPhase] = useState<MikuPhase>('stopped')
  const [hasModel, setHasModel] = useState(false)
  const [log, setLog] = useState('')
  const m = api()

  useEffect(() => {
    if (!m) return
    void m.status().then(setPhase)
    void m.hasModel().then(setHasModel)
    const offLog = m.onLog((line) =>
      setLog((prev) => (prev + line).split('\n').slice(-200).join('\n')),
    )
    const offStatus = m.onStatus(setPhase)
    return () => {
      offLog()
      offStatus()
    }
  }, [m])

  const start = useCallback(async () => {
    const r = await m?.start()
    if (r && !r.ok) setLog((p) => `${p}\n[start failed: ${r.error}]`)
  }, [m])
  const stop = useCallback(async () => {
    await m?.stop()
  }, [m])
  const openModels = useCallback(() => void m?.openModels(), [m])
  const refreshModel = useCallback(() => void m?.hasModel().then(setHasModel), [m])
  const downloadModel = useCallback(
    async (url: string, index?: string) => {
      const r = (await m?.downloadModel({ url, index })) ?? { ok: false, error: 'unavailable' }
      if (r.ok) void m?.hasModel().then(setHasModel)
      return r
    },
    [m],
  )

  return {
    available: !!m,
    phase,
    running: phase === 'ready',
    starting: phase === 'starting',
    failed: phase === 'error',
    hasModel,
    log,
    start,
    stop,
    openModels,
    refreshModel,
    downloadModel,
  }
}

/**
 * Auto-start the local Miku server when the custom engine is selected and a voice
 * model is present — so reopening the app (or switching to Miku) brings the server
 * up on its own instead of waiting for a manual trip to Settings.
 *
 * Fires on mount and whenever `enabled` flips true. Idempotent and conservative:
 * - only from the `stopped` phase, so it never races a `starting`/`ready` server;
 * - only when a model exists, so it won't spawn the heavy Python server with
 *   nothing to render (Settings still owns the no-model download flow);
 * - it does NOT react to later status changes, so a manual Stop within the session
 *   is respected — it won't immediately re-launch.
 *
 * No-op unless `enabled` (the custom/Miku engine is selected) and the managed Miku
 * bridge is available. Once `ready`, `useMikuPrewarm` warms the phrase cache.
 */
export function useMikuAutostart(enabled: boolean): void {
  const m = api()
  useEffect(() => {
    if (!m || !enabled) return
    let cancelled = false
    void (async () => {
      const [phase, hasModel] = await Promise.all([m.status(), m.hasModel()])
      if (cancelled || phase !== 'stopped' || !hasModel) return
      void m.start()
    })()
    return () => {
      cancelled = true
    }
  }, [m, enabled])
}

/**
 * Fire a one-shot prewarm of the Miku TTS cache when the server reaches `ready`.
 *
 * Renders the fixed assistant phrases (passed in by the caller — the single
 * source of truth) ahead of time so their first live use is a cache HIT instead
 * of a cold edge-tts + RVC render. Fires once per ready transition; re-arms when
 * the server restarts (phase leaves `ready`) and re-fires if the phrase set
 * changes while ready (e.g. the user switches voice language).
 *
 * No-op unless `enabled` (the custom/Miku engine is selected) and the managed
 * Miku bridge is available.
 */
export function useMikuPrewarm(enabled: boolean, phrases: readonly string[]): void {
  const m = api()
  const firedSig = useRef<string | null>(null)
  // Stable signature of the phrase set; drives the "already warmed this set" guard.
  const sig = phrases.join('␟')

  useEffect(() => {
    if (!m) return
    let phase: MikuPhase = 'stopped'

    const maybeFire = (): void => {
      if (!enabled || phase !== 'ready' || phrases.length === 0) return
      if (firedSig.current === sig) return
      firedSig.current = sig
      void m.prewarm?.([...phrases])
    }

    void m.status().then((p) => {
      phase = p
      maybeFire()
    })
    const off = m.onStatus((p) => {
      phase = p
      // A stop/restart re-arms prewarm so the next ready warms the cache again.
      if (p !== 'ready') firedSig.current = null
      maybeFire()
    })
    return off
    // `phrases` is captured via the stable `sig`; depending on the array identity
    // (new every render) would re-subscribe needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, enabled, sig])
}
