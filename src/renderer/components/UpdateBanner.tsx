import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { checkForUpdate, openExternal } from '@/settings/appInfo'

/**
 * Non-blocking "update available" banner. Checks GitHub Releases once on mount
 * (via the main process) and renders only when a newer version exists. Silent on
 * failure / offline / browser preview. Dismissible for the session.
 *
 * The action button routes to the real updater instead of hand-downloading: when
 * the electron-updater bridge is live (`window.claudedeck?.updater`), it navigates
 * to Settings — where the in-app updater UI and its own Releases-page fallback live
 * — so an NSIS install can differential-update itself rather than being sent to the
 * browser for a full installer + SmartScreen prompt. Only when the bridge is absent
 * (browser preview) does it fall back to `openExternal`. One owner per control: the
 * banner never duplicates download/progress UI.
 */
export default function UpdateBanner({
  onGoToSettings,
}: {
  onGoToSettings: () => void
}): JSX.Element | null {
  const [update, setUpdate] = useState<{ latest: string; url: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    void checkForUpdate().then((r) => {
      if (alive && r.ok && r.hasUpdate && r.latest && r.url) {
        setUpdate({ latest: r.latest, url: r.url })
      }
    })
    return () => {
      alive = false
    }
  }, [])

  if (!update || dismissed) return null

  // Bridge live → route to the in-app updater in Settings; absent (browser
  // preview) → open the Releases page directly. Same check picks the label.
  const hasUpdater = typeof window !== 'undefined' && Boolean(window.claudedeck?.updater)

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-sm"
    >
      <Download size={15} className="shrink-0 text-accent" />
      <span className="text-fg">
        เวอร์ชันใหม่ <strong className="text-accent">v{update.latest}</strong> พร้อมให้อัปเดตแล้ว
      </span>
      <button
        type="button"
        onClick={() => (hasUpdater ? onGoToSettings() : openExternal(update.url))}
        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
      >
        {hasUpdater ? 'อัปเดต' : 'ดาวน์โหลด'}
      </button>
      <button
        type="button"
        aria-label="Dismiss update notice"
        onClick={() => setDismissed(true)}
        className="ml-auto text-fg-muted transition-colors hover:text-fg"
      >
        <X size={15} />
      </button>
    </div>
  )
}
