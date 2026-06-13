import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { ChatMessage, Session } from '@/mock/fixtures'
import type { Effort, PermissionMode, QueuedMessage, PermissionRequestMsg } from '@/cli/types'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { SpawnContext } from './SpawnChip'
import { PermissionPrompt } from './PermissionPrompt'
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
  onSpawnTask,
  queued,
  onEnqueue,
  onInterrupt,
  onRemoveQueued,
  permissionRequest,
  onPermissionDecide,
  onPermissionAlwaysAllow,
  th = true,
}: {
  session: Session
  onSend: (text: string, modelId: string, effort?: Effort, images?: Array<{ mediaType: string; data: string }>) => void
  /** Stop/cancel the running turn (shown as a Stop button while busy). */
  onStop?: () => void
  composerRef?: React.Ref<ComposerHandle>
  permissionMode: PermissionMode
  onChangePermission: (mode: PermissionMode) => void
  onSetCwd: (path: string) => void
  onFork?: (seedText: string) => void
  /** Open a new tab in the given folder seeded with `prompt` (assistant spawn_task chip). */
  onSpawnTask?: (prompt: string, cwd?: string) => void
  queued?: QueuedMessage[]
  onEnqueue?: (text: string, modelId: string, effort?: Effort, images?: Array<{ mediaType: string; data: string }>) => void
  onInterrupt?: (text: string, modelId: string, effort?: Effort, images?: Array<{ mediaType: string; data: string }>) => void
  onRemoveQueued?: (id: string) => void
  /** The head pending tool-permission request for THIS session (null when none). */
  permissionRequest?: PermissionRequestMsg | null
  onPermissionDecide?: (req: PermissionRequestMsg, decision: 'allow' | 'deny') => void
  onPermissionAlwaysAllow?: (req: PermissionRequestMsg) => void
  th?: boolean
}): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Spawn action + current cwd for any spawn_task chip rendered in the message tree.
  // Context bypasses AssistantMessage's React.memo, so only live chips re-render.
  const spawnCtx = useMemo(
    () => ({ onSpawn: onSpawnTask ?? (() => {}), sessionCwd: session.cwd }),
    [onSpawnTask, session.cwd],
  )

  // Auto-scroll to bottom when messages change OR a permission prompt appears, so
  // the in-chat Allow/Deny card is never stranded below the fold.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session.messages.length, permissionRequest?.id])

  // Announce each COMPLETED assistant reply to external screen readers
  // (NVDA/JAWS) — the message list itself has no live region, so without this a
  // blind user never hears the answer. Announcing only on completion (not per
  // streaming token) keeps the reader from chattering through the whole stream.
  const [announced, setAnnounced] = useState('')
  const announcedId = useRef<string | null>(null)
  // Switching sessions must not announce the new session's old tail message.
  // Runs before the announce effect below (declaration order) on a switch.
  useEffect(() => {
    announcedId.current = null
    setAnnounced('')
  }, [session.id])
  useEffect(() => {
    const last = session.messages[session.messages.length - 1]
    if (!last || last.role !== 'assistant' || last.streaming) return
    if (announcedId.current === null) {
      // First run for this view (mount / session switch): record the already-
      // finished tail message without announcing old history.
      announcedId.current = last.id
      return
    }
    if (announcedId.current === last.id) return
    announcedId.current = last.id
    const text = announceText(last)
    if (text) setAnnounced(text)
  }, [session.messages])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="sr-only" role="status" aria-live="polite">
        {announced}
      </div>
      {/* Scrollable message area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 scrollbar-thin">
        <div className="mx-auto max-w-3xl">
          {session.messages.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <SpawnContext.Provider value={spawnCtx}>
                {session.messages.map((msg) =>
                  msg.role === 'user' ? (
                    <UserMessage key={msg.id} message={msg} />
                  ) : (
                    <AssistantMessage key={msg.id} message={msg} />
                  )
                )}
              </SpawnContext.Provider>
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
        onSpawn={onFork}
        queued={queued}
        onEnqueue={onEnqueue}
        onInterrupt={onInterrupt}
        onRemoveQueued={onRemoveQueued}
      />
    </div>
  )
}

/** Screen-reader text for a finished assistant message: prose only (no code/
 *  tool/thinking parts), truncated so the reader isn't stuck in a wall of text. */
const ANNOUNCE_MAX_CHARS = 400
function announceText(msg: ChatMessage): string {
  const text = msg.parts
    .filter((p): p is { kind: 'markdown'; text: string } => p.kind === 'markdown')
    .map((p) => p.text)
    .join(' ')
    .trim()
  return text.length > ANNOUNCE_MAX_CHARS ? `${text.slice(0, ANNOUNCE_MAX_CHARS)}…` : text
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
