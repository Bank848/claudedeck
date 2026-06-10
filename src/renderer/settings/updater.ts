/**
 * Renderer-side in-app auto-update state (electron-updater bridge).
 *
 * Only the packaged NSIS install can auto-update. In dev and in the portable zip
 * build there's no `app-update.yml`, so `check()` resolves `{ ok:false, error:'dev' }`.
 * This hook owns the fallback for that case too: it runs the REST "latest release"
 * check and opens the GitHub Releases page, exposing the merged result via
 * `statusText`. The view just renders `statusText` + the action buttons — no
 * update logic leaks into the component.
 *
 * `install()` quits the app to run the installer, so its promise never resolves —
 * app restart IS the success signal.
 */
import { useCallback, useEffect, useState } from 'react'
import { checkForUpdate, openExternal } from './appInfo'

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

export interface UseUpdater {
  available: boolean
  phase: UpdaterPhase
  percent: number
  /** One-line status for the aria-live region (covers both updater + REST paths). */
  statusText: string
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
}

/** Run the dev/zip fallback: REST latest-release check + open the Releases page. */
async function restFallback(setMsg: (s: string) => void): Promise<void> {
  setMsg('กำลังเช็ก…')
  const r = await checkForUpdate()
  setMsg(
    !r.ok
      ? `เช็กไม่ได้: ${r.error ?? ''}`
      : r.hasUpdate
        ? `มีเวอร์ชันใหม่ v${r.latest} — เปิดหน้าดาวน์โหลดให้แล้ว`
        : 'เป็นเวอร์ชันล่าสุดแล้ว ✓',
  )
  if (r.ok && r.hasUpdate && r.url) openExternal(r.url)
}

export function useUpdater(): UseUpdater {
  const u = api()
  const [phase, setPhase] = useState<UpdaterPhase>('idle')
  const [version, setVersion] = useState('')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')
  // Message for the dev/zip REST-fallback path (no electron-updater available).
  const [restMsg, setRestMsg] = useState('')

  useEffect(() => {
    if (!u) return
    const offs = [
      u.onAvailable((v) => {
        setVersion(v.version)
        setPhase('available')
      }),
      u.onNone(() => setPhase('none')),
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
    setError('')
    setRestMsg('')
    // No bridge (browser preview) → straight to the REST fallback.
    if (!u) {
      await restFallback(setRestMsg)
      return
    }
    setPhase('checking')
    const r = await u.check()
    if (!r.ok) {
      // dev / zip build (no app-update.yml) → REST fallback; real error → surface it.
      setPhase('idle')
      if (r.error === 'dev') await restFallback(setRestMsg)
      else {
        setError(r.error ?? 'เช็กไม่ได้')
        setPhase('error')
      }
      return
    }
    // Success: the verdict arrives via the available/none events.
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

  const statusText = ((): string => {
    switch (phase) {
      case 'checking':
        return 'กำลังเช็ก…'
      case 'available':
        return `มีเวอร์ชันใหม่ v${version} — กดดาวน์โหลด`
      case 'downloading':
        return `กำลังดาวน์โหลด… ${percent}%`
      case 'downloaded':
        return 'ดาวน์โหลดเสร็จ — รีสตาร์ทเพื่อติดตั้ง'
      case 'none':
        return 'เป็นเวอร์ชันล่าสุดแล้ว ✓'
      case 'error':
        return `เช็กไม่ได้: ${error}`
      default:
        return restMsg // idle: dev/zip REST-fallback message (or empty)
    }
  })()

  return { available: !!u, phase, percent, statusText, check, download, install }
}
