import { Mic, MicOff, Loader2 } from 'lucide-react'
import type { LocalVoiceStatus } from '@/settings/localVoice'

interface VoiceControlIndicatorProps {
  enabled: boolean
  mode: 'browser' | 'local'
  paused: boolean
  listening: boolean
  lastHeard: string
  localStatus: LocalVoiceStatus
  localProgress: number
  onPTTDown: () => void
  onPTTUp: () => void
}

/**
 * Floating status for the in-app voice assistant (accessibility).
 * Visible to sighted helpers; announced to screen readers via aria-live.
 */
export function VoiceControlIndicator({
  enabled,
  mode,
  paused,
  listening,
  lastHeard,
  localStatus,
  localProgress,
  onPTTDown,
  onPTTUp,
}: VoiceControlIndicatorProps): JSX.Element | null {
  if (!enabled) return null

  if (paused) {
    return (
      <div role="status" aria-live="polite" className="pointer-events-none fixed left-1/2 top-12 z-[100] -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-xs shadow-xl backdrop-blur">
          <PauseDot />
          <span className="font-medium text-fg">Voice assistant paused</span>
          <span className="text-fg-muted">— say “resume” / “เริ่มทำงานต่อ”</span>
        </div>
      </div>
    )
  }

  const localLabel: Record<LocalVoiceStatus, string> = {
    idle: 'Local voice idle',
    loading: `Loading model… ${localProgress}%`,
    ready: 'Hold to talk',
    listening: 'Listening…',
    thinking: 'Transcribing…',
    error: 'Model failed',
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-12 z-[100] -translate-x-1/2"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-accent/40 bg-surface/95 px-3 py-1.5 text-xs shadow-xl backdrop-blur">
        {mode === 'local' ? (
          <>
            {localStatus === 'loading' || localStatus === 'thinking' ? (
              <Loader2 size={13} className="animate-spin text-accent" />
            ) : listening ? (
              <PulseDot />
            ) : (
              <Mic size={13} className="text-accent" />
            )}
            <span className="font-medium text-fg">Voice assistant · {localLabel[localStatus]}</span>
            {/* Press-and-hold mic for sighted/touch users (keyboard: Ctrl+Shift+Space). */}
            <button
              type="button"
              aria-label="Push to talk"
              title="Hold to talk (or Ctrl+Shift+Space)"
              onMouseDown={onPTTDown}
              onMouseUp={onPTTUp}
              onMouseLeave={onPTTUp}
              disabled={localStatus !== 'ready' && localStatus !== 'listening'}
              className={`ml-1 flex h-6 w-6 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                listening ? 'bg-destructive/25 text-destructive' : 'bg-accent/20 text-accent hover:bg-accent/30'
              }`}
            >
              <Mic size={13} />
            </button>
          </>
        ) : (
          <>
            {listening ? <PulseDot /> : <MicOff size={13} className="text-fg-muted" />}
            <span className="font-medium text-fg">
              Voice assistant {listening ? 'listening' : 'starting…'}
            </span>
          </>
        )}
        {lastHeard && <span className="max-w-[220px] truncate text-fg-muted">“{lastHeard}”</span>}
      </div>
    </div>
  )
}

function PauseDot(): JSX.Element {
  return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-fg-muted" />
}

function PulseDot(): JSX.Element {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
    </span>
  )
}
