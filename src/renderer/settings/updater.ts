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
 *
 * Errors are op-aware: the same `onError` push event fires for a failed *check*
 * and a failed *download*, so we track which operation is in flight and phrase the
 * message accordingly (a mid-download network drop must not read as "can't check").
 * Raw errors (offline Node codes, `HTTP 403` rate-limit, `HTTP 404` no-releases from
 * the main REST handler) are mapped to actionable Thai via `friendlyError`.
 *
 * Stuck guard: a successful `check()` only resolves `{ok:true}` and then waits for an
 * `available`/`none` push event — but `safeSend` in main drops events when the window
 * is gone/recreating, which would strand the phase in `checking` and disable the button
 * forever. `createStuckGuard` arms a ~30s timer on a successful check that resets the UI
 * to `idle` (button usable again) if no verdict/error event arrives in time.
 *
 * The pure helpers (`friendlyError`, `updaterErrorText`, `createStuckGuard`) are exported
 * so they're unit-testable without React or the bridge.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { checkForUpdate, openExternal } from './appInfo'

function api() {
  return typeof window !== 'undefined' ? window.claudedeck?.updater : undefined
}

/** Which updater operation is in flight — decides how an error is phrased. */
export type UpdaterOp = 'check' | 'download'

/**
 * Map a raw error string (Node error codes, main-process `HTTP <status>` strings,
 * Chromium `net::ERR_*`) to an actionable Thai message. Unknown errors pass through.
 */
export function friendlyError(raw: string): string {
  if (/ENOTFOUND|ETIMEDOUT|EAI_AGAIN|net::ERR/i.test(raw)) return 'ออฟไลน์หรือเชื่อมต่อ GitHub ไม่ได้'
  if (/HTTP 403|rate limit/i.test(raw)) return 'GitHub จำกัดจำนวนครั้ง — ลองใหม่ภายหลัง'
  if (/HTTP 404/.test(raw)) return 'ยังไม่มีเวอร์ชันเผยแพร่'
  return raw
}

/**
 * Op-aware error line for the aria-live region. A failed *check* surfaces the friendly
 * detail; a failed *download* uses fixed retry wording (the raw cause is rarely
 * actionable mid-download and must never read as a check failure).
 */
export function updaterErrorText(op: UpdaterOp, raw: string): string {
  return op === 'download'
    ? 'ดาวน์โหลดอัปเดตไม่สำเร็จ — ลองใหม่อีกครั้ง'
    : `เช็กอัปเดตไม่สำเร็จ — ${friendlyError(raw)}`
}

/** Default stuck-check timeout: a check with no verdict/error event by now is stranded. */
export const STUCK_CHECK_TIMEOUT_MS = 30_000

/**
 * Framework-free single-shot timer guard. `arm()` (re-)starts the countdown; `disarm()`
 * cancels it. If the countdown elapses without a disarm, `onStuck` fires once. The hook
 * arms it after a successful check and disarms it in every verdict/error event + unmount.
 */
export function createStuckGuard(
  onStuck: () => void,
  timeoutMs: number = STUCK_CHECK_TIMEOUT_MS,
): { arm(): void; disarm(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const disarm = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  return {
    arm(): void {
      disarm()
      timer = setTimeout(() => {
        timer = undefined
        onStuck()
      }, timeoutMs)
    },
    disarm,
  }
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
      ? `เช็กอัปเดตไม่สำเร็จ — ${friendlyError(r.error ?? '')}`
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
  // Which operation is in flight, in a ref so the (mount-once) onError handler reads
  // the current value without re-subscribing. No render depends on it directly.
  const opRef = useRef<UpdaterOp>('check')
  const setOperation = useCallback((next: UpdaterOp) => {
    opRef.current = next
  }, [])

  // Stuck-check guard: a successful check awaits an event that safeSend may drop.
  // If nothing flips the phase in ~30s, reset to idle so the button works again.
  const stuckRef = useRef<ReturnType<typeof createStuckGuard>>()
  if (!stuckRef.current) {
    stuckRef.current = createStuckGuard(() => {
      setPhase('idle')
      setRestMsg('เช็กอัปเดตไม่ตอบสนอง — ลองใหม่')
    })
  }

  useEffect(() => {
    if (!u) return
    const guard = stuckRef.current
    const offs = [
      u.onAvailable((v) => {
        guard?.disarm()
        setVersion(v.version)
        setPhase('available')
      }),
      u.onNone(() => {
        guard?.disarm()
        setPhase('none')
      }),
      u.onProgress((p) => {
        setPercent(Math.round(p.percent))
        setPhase('downloading')
      }),
      u.onDownloaded(() => {
        guard?.disarm()
        setPhase('downloaded')
      }),
      u.onError((e) => {
        guard?.disarm()
        setError(updaterErrorText(opRef.current, e.error))
        setPhase('error')
      }),
    ]
    return () => {
      guard?.disarm()
      offs.forEach((off) => off())
    }
  }, [u])

  const check = useCallback(async () => {
    setError('')
    setRestMsg('')
    setOperation('check')
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
        setError(updaterErrorText('check', r.error ?? ''))
        setPhase('error')
      }
      return
    }
    // Success: the verdict arrives via the available/none events. Guard against a
    // dropped event stranding us in `checking`.
    stuckRef.current?.arm()
  }, [u, setOperation])

  const download = useCallback(async () => {
    if (!u) return
    setOperation('download')
    setPhase('downloading')
    setPercent(0)
    const r = await u.download()
    if (!r.ok) {
      setError(updaterErrorText('download', r.error ?? ''))
      setPhase('error')
    }
  }, [u, setOperation])

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
        return error // already op-aware + friendly (updaterErrorText)
      default:
        return restMsg // idle: dev/zip REST-fallback message (or empty)
    }
  })()

  return { available: !!u, phase, percent, statusText, check, download, install }
}
