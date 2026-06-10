/**
 * Renderer-side in-app auto-update state (electron-updater bridge).
 *
 * Only the packaged NSIS install can auto-update. In dev and in the portable zip
 * build there's no `app-update.yml`, so `check()` resolves `{ ok:false, error:'dev' }`
 * → we mark the flow `unsupported` and the UI falls back to the GitHub Releases
 * link. `install()` quits the app to run the installer, so its promise never
 * resolves — app restart IS the success signal, not a resolved promise.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

function api() {
  return typeof window !== 'undefined' ? window.claudedeck?.updater : undefined
}

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'none'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

export interface UseUpdater {
  available: boolean
  phase: UpdaterPhase
  version: string
  percent: number
  error: string
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
}

export function useUpdater(): UseUpdater {
  const u = api()
  const [phase, setPhase] = useState<UpdaterPhase>('idle')
  const [version, setVersion] = useState('')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')
  // setPhase from event handlers can race the check() return; a ref lets check()
  // avoid clobbering an 'available'/'none' that already arrived via event.
  const settled = useRef(false)

  useEffect(() => {
    if (!u) return
    const offs = [
      u.onAvailable((v) => {
        settled.current = true
        setVersion(v.version)
        setPhase('available')
      }),
      u.onNone(() => {
        settled.current = true
        setPhase('none')
      }),
      u.onProgress((p) => {
        setPercent(Math.round(p.percent))
        setPhase('downloading')
      }),
      u.onDownloaded(() => setPhase('downloaded')),
      u.onError((e) => {
        setError(e.error)
        setPhase('error')
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [u])

  const check = useCallback(async () => {
    if (!u) {
      setPhase('unsupported')
      return
    }
    settled.current = false
    setError('')
    setPhase('checking')
    const r = await u.check()
    // dev / zip build (no app-update.yml) → fall back to the Releases link.
    if (!r.ok) {
      setPhase(r.error === 'dev' ? 'unsupported' : 'error')
      if (r.error && r.error !== 'dev') setError(r.error)
      return
    }
    // Success: the real verdict arrives via the available/none events. If none has
    // fired by now, stay in 'checking' until it does.
  }, [u])

  const download = useCallback(async () => {
    if (!u) return
    setPhase('downloading')
    setPercent(0)
    const r = await u.download()
    if (!r.ok) {
      setError(r.error ?? 'download failed')
      setPhase('error')
    }
  }, [u])

  const install = useCallback(async () => {
    // Resolves only if the install was a no-op (dev); normally the app quits here.
    await u?.install()
  }, [u])

  return {
    available: !!u,
    phase,
    version,
    percent,
    error,
    check,
    download,
    install,
  }
}
