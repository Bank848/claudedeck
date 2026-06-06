import { useEffect, useState } from 'react'
import { useSettings } from '@/settings/SettingsContext'

export function StreamingCursor(): JSX.Element {
  const { settings } = useSettings()
  const prefersReducedMotion =
    settings.reduceMotion ||
    (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (prefersReducedMotion) return
    const id = setInterval(() => {
      setVisible((v) => !v)
    }, 530)
    return () => clearInterval(id)
  }, [prefersReducedMotion])

  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block w-[2px] h-[1em] align-middle bg-accent transition-opacity duration-100"
      style={{ opacity: prefersReducedMotion ? 1 : visible ? 1 : 0 }}
    />
  )
}
