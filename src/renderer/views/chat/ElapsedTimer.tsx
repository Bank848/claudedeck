import { useEffect, useState } from 'react'

/** mm:ss for a non-negative whole-second count (e.g. 42 → "0:42", 95 → "1:35"). */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const rest = s % 60
  return `${m}:${String(rest).padStart(2, '0')}`
}

/**
 * Live mm:ss counter for an in-flight turn. Ticks once per second from `startIso`
 * (the streaming assistant message's createdAt) so the user can see how long the
 * model has been working — the missing "running clock" while Opus thinks before
 * the first token lands. Pure display; the parent decides when to mount/unmount.
 */
export function ElapsedTimer({ startIso }: { startIso: string }): JSX.Element {
  const start = new Date(startIso).getTime()
  const valid = !Number.isNaN(start)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!valid) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [valid])

  const seconds = valid ? (now - start) / 1000 : 0
  return <span className="tabular-nums">{formatElapsed(seconds)}</span>
}
