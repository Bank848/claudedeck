import { memo } from 'react'
import { Sparkles } from 'lucide-react'
import { MarkdownContent } from './MarkdownContent'
import { CodeBlock } from './CodeBlock'
import { ToolCallCard } from './ToolCallCard'
import { ThinkingBlock } from './ThinkingBlock'
import { StreamingCursor } from './StreamingCursor'
import { ReadAloudButton } from './ReadAloudButton'
import type { ChatMessage } from '@/mock/fixtures'
import { plainSpeakableText } from '@/settings/speech'

interface AssistantMessageProps {
  message: ChatMessage
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

/** Join the readable prose from a message's parts for text-to-speech. */
function speakableText(message: ChatMessage): string {
  return plainSpeakableText(
    message.parts
      .map((p) => {
        if (p.kind === 'markdown' || p.kind === 'thinking') return p.text
        if (p.kind === 'code') return 'code block.'
        if (p.kind === 'tool') return `Tool ${p.call.tool}: ${p.call.label}.`
        return ''
      })
      .join('. '),
  )
}

// memo: the sessions reducer replaces only the streaming message object per
// stream event (others keep reference identity), so completed messages skip
// re-render — and re-parsing markdown / re-highlighting code — on every token.
export const AssistantMessage = memo(function AssistantMessage({ message }: AssistantMessageProps): JSX.Element {
  const parts = message.parts

  return (
    <div className="flex gap-3 mb-6 group">
      {/* Coral spark avatar */}
      <div className="shrink-0 mt-0.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/20 border border-accent/30">
          <Sparkles size={14} className="text-accent" />
        </div>
      </div>

      {/* Message body */}
      <div className="min-w-0 flex-1">
        {/* Timestamp + read-aloud */}
        <div className="mb-1 flex items-center gap-1">
          <span className="text-xs text-fg-muted tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(message.createdAt)}
          </span>
          <ReadAloudButton text={speakableText(message)} />
        </div>

        {parts.map((part, i) => {
          if (part.kind === 'markdown') {
            return <MarkdownContent key={i} text={part.text} />
          }
          if (part.kind === 'code') {
            return <CodeBlock key={i} content={part.content} />
          }
          if (part.kind === 'tool') {
            return <ToolCallCard key={i} call={part.call} />
          }
          if (part.kind === 'thinking') {
            return <ThinkingBlock key={i} text={part.text} />
          }
          return null
        })}

        {message.streaming && (
          <span className="mt-1 inline-block text-sm text-fg">
            <StreamingCursor />
          </span>
        )}
      </div>
    </div>
  )
})
