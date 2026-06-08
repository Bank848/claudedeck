import { useState } from 'react'
import { LogIn, X } from 'lucide-react'
import type { useAuth } from '@/cli/useAuth'
import { LoginFlow } from './LoginFlow'

type Auth = ReturnType<typeof useAuth>

/** Top-of-chat banner shown only when logged out. Dismissible for the session. */
export function LoginBanner({ auth }: { auth: Auth }): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false)
  if (auth.status.loggedIn || dismissed) return null
  return (
    <div className="border-b border-border bg-surface px-4 py-2">
      <div className="flex items-center gap-3 text-sm">
        <LogIn size={16} className="text-accent" />
        <span className="flex-1 text-fg-muted">
          You&apos;re not logged in — Live mode needs a Claude account.
        </span>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="text-fg-muted hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-2">
        <LoginFlow auth={auth} />
      </div>
    </div>
  )
}
