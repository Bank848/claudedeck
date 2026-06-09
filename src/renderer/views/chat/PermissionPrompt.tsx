import { useEffect, useRef } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { PermissionRequestMsg } from '@/cli/types'

/**
 * Modal asking the user to allow/deny a tool the CLI wants to run mid-turn.
 * Accessible: `role="alertdialog"`, focus moves to Allow on open, Enter = Allow,
 * Esc = Deny, focus is trapped between the two buttons. An "Always allow" action
 * persists the tool to the allow list so it won't ask again.
 */
export interface PermissionPromptProps {
  request: PermissionRequestMsg
  onDecide: (decision: 'allow' | 'deny') => void
  onAlwaysAllow: () => void
}

export function PermissionPrompt({ request, onDecide, onAlwaysAllow }: PermissionPromptProps): JSX.Element {
  const allowRef = useRef<HTMLButtonElement>(null)
  const denyRef = useRef<HTMLButtonElement>(null)

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
    } else if (e.key === 'Tab') {
      // Trap focus between the two primary buttons.
      e.preventDefault()
      ;(document.activeElement === allowRef.current ? denyRef : allowRef).current?.focus()
    }
  }

  const inputPreview = (() => {
    try {
      return JSON.stringify(request.input, null, 2)
    } catch {
      return String(request.input)
    }
  })()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onKeyDown={onKeyDown}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="perm-title"
        aria-describedby="perm-desc"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert size={18} className="text-amber-400" />
          <h2 id="perm-title" className="text-sm font-semibold text-fg">
            ขออนุญาตใช้เครื่องมือ <span className="font-mono text-accent">{request.tool}</span>
          </h2>
        </div>

        <p id="perm-desc" className="mb-2 text-xs text-fg-muted">
          Claude ต้องการใช้เครื่องมือ <span className="font-mono">{request.tool}</span> — อนุญาตหรือไม่?
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
            ปฏิเสธ (Esc)
          </button>
          <button
            type="button"
            onClick={onAlwaysAllow}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            อนุญาตเสมอ
          </button>
          <button
            ref={allowRef}
            type="button"
            onClick={() => onDecide('allow')}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            อนุญาต (Enter)
          </button>
        </div>
      </div>
    </div>
  )
}
