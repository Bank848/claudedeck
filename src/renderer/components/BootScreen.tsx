import { useEffect, useRef, useState } from 'react'

export type BootStep = 'sessions' | 'cli' | 'done'

interface Props {
  step: BootStep
  elapsed: number
  visible: boolean
}

interface StepRow {
  key: BootStep | '_cli'
  label: string
  detail: string
  done: boolean
  active: boolean
}

export function BootScreen({ step, elapsed, visible }: Props): JSX.Element | null {
  if (!visible) return null

  const sessionsDone = step !== 'sessions'
  const cliDone = step === 'done'

  const rows: StepRow[] = [
    {
      key: 'sessions',
      label: 'Load saved sessions',
      detail: 'IPC → main → %APPDATA%/claudedeck/sessions.json',
      done: sessionsDone,
      active: step === 'sessions',
    },
    {
      key: '_cli',
      label: 'Probe Claude CLI',
      detail: 'spawn: claude --version',
      done: cliDone,
      active: step === 'cli',
    },
  ]

  const hung = elapsed >= 8

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgb(13 13 12)',
        color: 'rgb(250 249 245)',
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        padding: 32,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', color: 'rgb(217 119 87)', marginBottom: 28, textTransform: 'uppercase' }}>
        ClaudeDeck
      </div>

      {/* Step checklist */}
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'rgb(22 22 21)',
          border: '1px solid rgb(42 41 38)',
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        {rows.map((row, i) => (
          <div
            key={row.key}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '12px 16px',
              borderTop: i === 0 ? 'none' : '1px solid rgb(42 41 38)',
              background: row.active && hung ? 'rgb(31 20 10)' : 'transparent',
            }}
          >
            <StatusIcon done={row.done} active={row.active} />
            <div>
              <div style={{ fontSize: 13, color: row.done ? 'rgb(168 165 158)' : 'rgb(250 249 245)', fontWeight: row.active ? 500 : 400 }}>
                {row.label}
              </div>
              <div style={{ fontSize: 11, color: 'rgb(168 165 158)', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                {row.detail}
              </div>
              {row.active && hung && (
                <div style={{ fontSize: 11, color: 'rgb(239 68 68)', marginTop: 4 }}>
                  stuck here — {elapsed}s elapsed
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Elapsed */}
      <div style={{ fontSize: 12, color: 'rgb(168 165 158)', fontFamily: "'JetBrains Mono', monospace", marginBottom: hung ? 20 : 0 }}>
        {elapsed}s
      </div>

      {/* Hung advice */}
      {hung && (
        <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'rgb(168 165 158)', lineHeight: 1.6 }}>
            Open DevTools (Ctrl+Shift+I) → Console tab to see what's blocking.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              alignSelf: 'flex-start',
              padding: '7px 18px',
              background: 'rgb(31 30 29)',
              border: '1px solid rgb(58 56 53)',
              borderRadius: 6,
              color: 'rgb(250 249 245)',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
            }}
          >
            Reload app
          </button>
        </div>
      )}
    </div>
  )
}

function StatusIcon({ done, active }: { done: boolean; active: boolean }): JSX.Element {
  if (done) {
    return (
      <span style={{ color: 'rgb(34 197 94)', fontSize: 14, lineHeight: '20px', flexShrink: 0 }}>✓</span>
    )
  }
  if (active) {
    return (
      <>
        <style>{`@keyframes cdspin{to{transform:rotate(360deg)}}`}</style>
        <span
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            border: '2px solid rgb(42 41 38)',
            borderTopColor: 'rgb(168 165 158)',
            borderRadius: '50%',
            animation: 'cdspin 0.8s linear infinite',
            flexShrink: 0,
            marginTop: 2,
          }}
        />
      </>
    )
  }
  return (
    <span style={{ color: 'rgb(42 41 38)', fontSize: 14, lineHeight: '20px', flexShrink: 0 }}>○</span>
  )
}

export function useBootTimer(running: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())

  useEffect(() => {
    if (!running) return
    startRef.current = Date.now()
    setElapsed(0)
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [running])

  return elapsed
}
