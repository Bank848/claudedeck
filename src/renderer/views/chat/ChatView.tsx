import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import type { Session } from '@/mock/fixtures'
import type { Effort, PermissionMode } from '@/cli/types'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { Composer, type ComposerHandle } from './Composer'

export default function ChatView({
  session,
  onSend,
  onStop,
  composerRef,
  permissionMode,
  onChangePermission,
  onSetCwd,
  onFork,
}: {
  session: Session
  onSend: (text: string, modelId: string, effort?: Effort) => void
  /** Stop/cancel the running turn (shown as a Stop button while busy). */
  onStop?: () => void
  composerRef?: React.Ref<ComposerHandle>
  permissionMode: PermissionMode
  onChangePermission: (mode: PermissionMode) => void
  onSetCwd: (path: string) => void
  onFork?: (seedText: string) => void
}): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session.messages.length])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      {/* Scrollable message area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 scrollbar-thin">
        <div className="mx-auto max-w-3xl">
          {session.messages.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {session.messages.map((msg) =>
                msg.role === 'user' ? (
                  <UserMessage key={msg.id} message={msg} />
                ) : (
                  <AssistantMessage key={msg.id} message={msg} />
                )
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>
      </div>

      {/* Sticky composer */}
      <Composer
        ref={composerRef}
        model={session.model}
        onSend={onSend}
        onStop={onStop}
        busy={session.status === 'running'}
        tokens={session.tokens}
        permissionMode={permissionMode}
        onChangePermission={onChangePermission}
        onSetCwd={onSetCwd}
        onFork={onFork}
      />
    </div>
  )
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 border border-accent/25">
        <Sparkles size={24} className="text-accent" />
      </div>
      <h2 className="mb-1 text-base font-semibold text-fg">Start a conversation</h2>
      <p className="max-w-xs text-sm text-fg-muted leading-relaxed">
        Type a message below or use{' '}
        <span className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/</span>{' '}
        to browse skills.
      </p>
    </div>
  )
}
