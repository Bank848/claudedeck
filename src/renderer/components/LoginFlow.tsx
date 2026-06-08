import { useState } from 'react'
import type { useAuth } from '@/cli/useAuth'

type Auth = ReturnType<typeof useAuth>

/** Renders the right control for the current login phase. Reused by the
 *  logged-out banner and the Settings → Account section. */
export function LoginFlow({ auth }: { auth: Auth }): JSX.Element {
  const [code, setCode] = useState('')
  const { phase, error } = auth

  // GAP fix (review): proactive CLI-missing message per spec.
  if (!auth.cliAvailable) {
    return (
      <p className="text-sm text-fg-muted">
        Claude CLI not found — install Claude Code, then restart the app to log in.
      </p>
    )
  }

  if (phase === 'opening') {
    return <p className="text-sm text-fg-muted">Opening your browser to sign in…</p>
  }

  if (phase === 'awaiting-code' || phase === 'submitting') {
    const submitting = phase === 'submitting'
    return (
      <div className="space-y-2">
        <p className="text-sm text-fg-muted">
          We opened your browser. After approving, paste the code shown there:
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste code"
            aria-label="Login code"
            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
          <button
            disabled={!code.trim() || submitting}
            onClick={() => void auth.submitCode(code)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
          <button
            onClick={() => void auth.cancel()}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    )
  }

  // idle or error → Log in button
  return (
    <div className="space-y-2">
      <button
        onClick={() => void auth.login()}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
      >
        Log in
      </button>
      {phase === 'error' && error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
