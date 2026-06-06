/** Renderer-side controls for the local Miku voice server (managed by main). */
import { useCallback, useEffect, useState } from 'react'

function api() {
  return typeof window !== 'undefined' ? window.claudedeck?.miku : undefined
}

export function isMikuManaged(): boolean {
  return !!api()
}

interface UseMikuServer {
  available: boolean
  running: boolean
  hasModel: boolean
  log: string
  start: () => Promise<void>
  stop: () => Promise<void>
  openModels: () => void
  refreshModel: () => void
  downloadModel: (url: string, index?: string) => Promise<{ ok: boolean; error?: string }>
}

export function useMikuServer(): UseMikuServer {
  const [running, setRunning] = useState(false)
  const [hasModel, setHasModel] = useState(false)
  const [log, setLog] = useState('')
  const m = api()

  useEffect(() => {
    if (!m) return
    void m.status().then(setRunning)
    void m.hasModel().then(setHasModel)
    const offLog = m.onLog((line) =>
      setLog((prev) => (prev + line).split('\n').slice(-200).join('\n')),
    )
    const offStatus = m.onStatus(setRunning)
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
    running,
    hasModel,
    log,
    start,
    stop,
    openModels,
    refreshModel,
    downloadModel,
  }
}
