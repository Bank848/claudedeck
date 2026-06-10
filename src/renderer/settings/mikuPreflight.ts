/**
 * Renderer-side Miku preflight + embedded-Python setup state.
 *
 * The pass/warn/fail DECISION is owned by the main process (electron/mikuPreflight
 * `decide()`); this module only invokes it via the bridge, formats the verdict for
 * the UI (aria-live strings), and tracks setup progress. The pure formatters are
 * exported separately so they're unit-testable without React or the bridge.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Verdict, Check, Level } from '../../../electron/mikuPreflight'
import type { MikuSetupProgress } from '../../../electron/preload'

function api() {
  return typeof window !== 'undefined' ? window.claudedeck?.miku : undefined
}

/** First failing check's detail, or null when nothing failed / no verdict yet. */
export function failReason(v: Verdict | null): string | null {
  if (!v) return null
  return v.checks.find((c) => c.level === 'fail')?.detail ?? null
}

/** One-line status for `aria-live` — distinguishes blocked vs warn vs ready. */
export function summarize(v: Verdict | null): string {
  if (!v) return 'ยังไม่ได้ตรวจสอบเครื่อง'
  if (!v.ok) return `ใช้ Miku ไม่ได้: ${failReason(v) ?? 'เครื่องไม่ผ่านการตรวจสอบ'}`
  if (v.level === 'warn') return 'ใช้ได้ (มีคำเตือน) — จะตั้งค่าแบบ CPU (ช้ากว่า)'
  return 'เครื่องพร้อมสำหรับ Miku'
}

/** Human label for a setup-progress tick (message first, step+percent fallback). */
export function progressLabel(p: MikuSetupProgress | null): string {
  if (!p) return ''
  return p.message || `${p.step} ${p.percent}%`
}

export type { Verdict, Check, Level, MikuSetupProgress }

export interface UseMikuPreflight {
  available: boolean
  verdict: Verdict | null
  checking: boolean
  /** A fail-level verdict — Miku setup must not proceed; stay on edge-tts. */
  blocked: boolean
  level: Level | null
  checks: Check[]
  /** True while the embedded-python setup is running. */
  settingUp: boolean
  progress: MikuSetupProgress | null
  runPreflight: () => Promise<Verdict | null>
  runSetup: () => Promise<{ ok: boolean; error?: string }>
}

export function useMikuPreflight(): UseMikuPreflight {
  const m = api()
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [checking, setChecking] = useState(false)
  const [settingUp, setSettingUp] = useState(false)
  const [progress, setProgress] = useState<MikuSetupProgress | null>(null)
  // Latest verdict in a ref so runSetup can read it without a stale closure.
  const verdictRef = useRef<Verdict | null>(null)

  useEffect(() => {
    if (!m?.onSetupProgress) return
    return m.onSetupProgress((p) => setProgress(p))
  }, [m])

  const runPreflight = useCallback(async (): Promise<Verdict | null> => {
    if (!m?.preflight) return null
    setChecking(true)
    try {
      const v = await m.preflight()
      verdictRef.current = v
      setVerdict(v)
      return v
    } finally {
      setChecking(false)
    }
  }, [m])

  const runSetup = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!m?.setup) return { ok: false, error: 'unavailable' }
    // Re-check if we have no verdict yet; never start setup on a blocked machine.
    const v = verdictRef.current ?? (await runPreflight())
    if (v && !v.ok) return { ok: false, error: failReason(v) ?? 'preflight failed' }
    setSettingUp(true)
    setProgress(null)
    try {
      return await m.setup()
    } finally {
      setSettingUp(false)
    }
  }, [m, runPreflight])

  return {
    available: !!m?.preflight,
    verdict,
    checking,
    blocked: verdict ? !verdict.ok : false,
    level: verdict?.level ?? null,
    checks: verdict?.checks ?? [],
    settingUp,
    progress,
    runPreflight,
    runSetup,
  }
}
