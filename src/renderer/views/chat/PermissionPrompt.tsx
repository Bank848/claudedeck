import { useEffect, useRef } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { PermissionRequestMsg } from '@/cli/types'

/**
 * Asks the user to allow/deny a tool the CLI wants to run mid-turn.
 *
 * Two variants:
 *  - `inline` (default): an amber-bordered card that lives INSIDE the originating
 *    session's chat, right above the composer. This is what users see — a prompt
 *    that belongs to its own conversation, not a global modal hijacking whatever
 *    tab is focused. No focus trap (it's part of the page, not a dialog).
 *  - `modal`: the legacy full-screen `alertdialog` with a focus trap across all
 *    three actions. Kept for any caller that still wants a blocking overlay.
 *
 * Accessible in both: focus moves to Allow on open, Enter = Allow, Esc = Deny.
 * "Always allow" persists the tool to the allow list so it won't ask again.
 */
export interface PermissionPromptProps {
  request: PermissionRequestMsg
  onDecide: (decision: 'allow' | 'deny') => void
  onAlwaysAllow: () => void
  /** Active language is Thai — drives bilingual copy (matches ForkDialog). */
  th?: boolean
  /** 'inline' (in-chat card, default) or 'modal' (legacy blocking overlay). */
  variant?: 'inline' | 'modal'
}

export function PermissionPrompt({ request, onDecide, onAlwaysAllow, th = true, variant = 'inline' }: PermissionPromptProps): JSX.Element {
  const allowRef = useRef<HTMLButtonElement>(null)
  const alwaysRef = useRef<HTMLButtonElement>(null)
  const denyRef = useRef<HTMLButtonElement>(null)
  const isModal = variant === 'modal'

  useEffect(() => {
    allowRef.current?.focus()
  }, [request.id])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onDecide('deny')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onDecide('allow')
    } else if (e.key === 'Tab' && isModal) {
      // Modal only: trap focus across all three actions, both directions. Inline
      // is part of the page flow, so Tab must escape naturally to the composer.
      e.preventDefault()
      const order = [denyRef, alwaysRef, allowRef] // left→right as rendered
      const i = order.findIndex((r) => r.current === document.activeElement)
      const dir = e.shiftKey ? -1 : 1
      const next = (i === -1 ? order.length - 1 : i + dir + order.length) % order.length
      order[next].current?.focus()
    }
  }

  const inputPreview = (() => {
    try {
      return JSON.stringify(request.input, null, 2)
    } catch {
      return String(request.input)
    }
  })()

  const card = (
    <div
      role="alertdialog"
      aria-modal={isModal || undefined}
      aria-labelledby="perm-title"
      aria-describedby="perm-desc"
      onKeyDown={isModal ? undefined : onKeyDown}
      className={
        isModal
          ? 'w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl'
          : 'rounded-lg border border-amber-400/50 bg-amber-400/5 p-4 shadow-sm'
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <ShieldAlert size={18} className="text-amber-400" />
        <h2 id="perm-title" className="text-sm font-semibold text-fg">
          {th ? 'ขออนุญาตใช้เครื่องมือ' : 'Permission to use tool'}{' '}
          <span className="font-mono text-accent">{request.tool}</span>
        </h2>
      </div>

      <p id="perm-desc" className="mb-2 text-xs text-fg-muted">
        {th ? (
          <>
            Claude ต้องการใช้เครื่องมือ <span className="font-mono">{request.tool}</span> — อนุญาตหรือไม่?
          </>
        ) : (
          <>
            Claude wants to run <span className="font-mono">{request.tool}</span> — allow it?
          </>
        )}
      </p>

      <pre className="mb-4 max-h-48 overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-[11px] leading-relaxed text-fg-muted">
        {inputPreview}
      </pre>

      <div className="flex items-center justify-end gap-2">
        <button
          ref={denyRef}
          type="button"
          onClick={() => onDecide('deny')}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-destructive hover:text-destructive"
        >
          {th ? 'ปฏิเสธ (Esc)' : 'Deny (Esc)'}
        </button>
        <button
          ref={alwaysRef}
          type="button"
          onClick={onAlwaysAllow}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
        >
          {th ? 'อนุญาตเสมอ' : 'Always allow'}
        </button>
        <button
          ref={allowRef}
          type="button"
          onClick={() => onDecide('allow')}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {th ? 'อนุญาต (Enter)' : 'Allow (Enter)'}
        </button>
      </div>
    </div>
  )

  if (!isModal) return card

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onKeyDown={onKeyDown}
    >
      {card}
    </div>
  )
}
