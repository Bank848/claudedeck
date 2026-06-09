import { memo } from 'react'
import { MarkdownContent } from './MarkdownContent'
import type { ChatMessage } from '@/mock/fixtures'

interface UserMessageProps {
  message: ChatMessage
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

// memo: see AssistantMessage — message identity is stable once sent, so user
// bubbles never need to re-render during a streaming turn.
export const UserMessage = memo(function UserMessage({ message }: UserMessageProps): JSX.Element {
  return (
    <div className="flex justify-end mb-4">
      <div className="flex flex-col items-end gap-1 max-w-[80%]">
        <div className="rounded-2xl rounded-tr-sm bg-surface border border-border px-4 py-3 text-sm text-fg leading-relaxed">
          {message.parts.map((part, i) => {
            if (part.kind === 'markdown') {
              return <MarkdownContent key={i} text={part.text} />
            }
            return null
          })}
        </div>
        <span className="text-xs text-fg-muted px-1 tabular-nums">
          {formatTime(message.createdAt)}
        </span>
      </div>
    </div>
  )
})
