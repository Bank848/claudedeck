import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import type { RoutingDecision, Tier } from '@/settings/modelRouting'
import { keyToChoice, trapTabIndex } from './modelSuggestionControls'

/**
 * Accessible confirm dialog for a per-turn model suggestion (blind user is first-class):
 * `role="alertdialog"`, focus moves to Confirm on open and is RESTORED to the prior element
 * on close, the suggestion + reason are announced via `aria-live="assertive"`, Enter = confirm
 * the suggestion, Esc = use the resting model, and Tab cycles all four buttons. Model-name
 * voice commands are wired in App while this is open (see modelSuggestionControls.voiceToChoice).
 */
export interface ModelSuggestionProps {
  decision: RoutingDecision
  restingTier: Tier
  /** Resolve the pending send with the chosen tier. */
  onChoose: (tier: Tier) => void
  /** Bilingual label for a tier (injected so the dialog has no fixtures dependency). */
  tierLabel: (t: Tier) => string
  th: boolean
}

export function ModelSuggestion({ decision, restingTier, onChoose, tierLabel, th }: ModelSuggestionProps): JSX.Element {
  const suggested = decision.tier
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const activeRef = useRef(0)

  // Restore focus to whatever was focused before the dialog opened (the composer).
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    btnRefs.current[0]?.focus()
    activeRef.current = 0
    return () => prev?.focus?.()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const next = trapTabIndex(activeRef.current, btnRefs.current.length, e.shiftKey)
      activeRef.current = next
      btnRefs.current[next]?.focus()
      return
    }
    const choice = keyToChoice(e.key, suggested, restingTier)
    if (choice) {
      e.preventDefault()
      onChoose(choice)
    }
  }

  const reason = decision.suggestion.reason
  const announce = th
    ? `แนะนำ ${tierLabel(suggested)} — ${reason}`
    : `Suggested ${tierLabel(suggested)} — ${reason}`

  const buttons: { tier: Tier; label: string; primary?: boolean }[] = [
    { tier: suggested, label: `${th ? 'ใช้' : 'Use'} ${tierLabel(suggested)} (Enter)`, primary: true },
    { tier: restingTier, label: `${th ? 'ใช้ตัวเดิม' : 'Keep'} ${tierLabel(restingTier)} (Esc)` },
    { tier: 'fable', label: `↑ ${tierLabel('fable')}` },
    { tier: 'haiku', label: `↓ ${tierLabel('haiku')}` },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onKeyDown={onKeyDown}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="model-suggest-title"
        aria-describedby="model-suggest-desc"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={18} className="text-accent" />
          <h2 id="model-suggest-title" className="text-sm font-semibold text-fg">
            {th ? 'แนะนำโมเดลสำหรับเทิร์นนี้' : 'Suggested model for this turn'}
          </h2>
        </div>

        {/* Assertive live region: a screen reader announces the suggestion + reason on open. */}
        <p id="model-suggest-desc" aria-live="assertive" className="mb-4 text-xs text-fg-muted">
          {announce}
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {buttons.map((b, i) => (
            <button
              key={`${b.tier}-${i}`}
              ref={(el) => (btnRefs.current[i] = el)}
              type="button"
              onClick={() => onChoose(b.tier)}
              className={
                b.primary
                  ? 'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
                  : 'rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
              }
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
