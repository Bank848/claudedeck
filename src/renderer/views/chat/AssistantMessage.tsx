import { memo } from 'react'
import { Sparkles } from 'lucide-react'
import { MarkdownContent } from './MarkdownContent'
import { CodeBlock } from './CodeBlock'
import { ToolCallCard } from './ToolCallCard'
import { ThinkingBlock } from './ThinkingBlock'
import { SpawnChip } from './SpawnChip'
import { StreamingCursor } from './StreamingCursor'
import { ElapsedTimer } from './ElapsedTimer'
import { ReadAloudButton } from './ReadAloudButton'
import { CopyButton } from './CopyButton'
import { MODELS, type ChatMessage } from '@/mock/fixtures'
import { plainSpeakableText, resolveLang } from '@/settings/speech'
import { useSettings } from '@/settings/SettingsContext'

/** Short label for the per-turn model badge (e.g. "Fable 5"); '' when unknown/unset. */
function modelBadge(id: string | undefined): string {
  if (!id) return ''
  const label = MODELS.find((m) => m.id === id)?.label ?? id
  return label.replace(/^Claude\s+/, '')
}

interface AssistantMessageProps {
  message: ChatMessage
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * Reconstruct the message as Markdown for copy-to-clipboard: prose verbatim and
 * code as fenced blocks (so it pastes back as usable Markdown). Thinking and tool
 * cards are UI chrome, not part of the answer, so they're left out.
 */
function copyableText(message: ChatMessage): string {
  return message.parts
    .map((p) => {
      if (p.kind === 'markdown') return p.text
      if (p.kind === 'code') return `\`\`\`${p.content.language ?? ''}\n${p.content.code}\n\`\`\``
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

/** Join the readable prose from a message's parts for text-to-speech. */
function speakableText(message: ChatMessage): string {
  return plainSpeakableText(
    message.parts
      .map((p) => {
        if (p.kind === 'markdown' || p.kind === 'thinking') return p.text
        if (p.kind === 'code') return 'code block.'
        if (p.kind === 'tool') return `Tool ${p.call.tool}: ${p.call.label}.`
        if (p.kind === 'spawn-chip') return `Suggested follow-up task: ${p.chip.title}.`
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
  const { settings } = useSettings()
  const th = resolveLang(settings.voiceLang).short === 'th'

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
          <span className="text-xs text-fg-muted tabular-nums">
            {formatTime(message.createdAt)}
          </span>
          {modelBadge(message.model) && (
            <span
              className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-fg-muted"
              title={`ตอบโดยโมเดล ${modelBadge(message.model)}`}
            >
              {modelBadge(message.model)}
            </span>
          )}
          <ReadAloudButton text={speakableText(message)} />
          <CopyButton text={copyableText(message)} />
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
          if (part.kind === 'spawn-chip') {
            return <SpawnChip key={part.chip.toolUseId} chip={part.chip} />
          }
          return null
        })}

        {message.streaming && (
          <div className="mt-1 flex items-center gap-2 text-sm text-fg" role="status" aria-live="off">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
            />
            <span className="text-xs text-fg-muted">{th ? 'กำลังทำงาน' : 'Working'}</span>
            <span className="text-xs text-fg-muted">·</span>
            <span className="text-xs text-fg-muted">
              <ElapsedTimer startIso={message.createdAt} />
            </span>
            <StreamingCursor />
          </div>
        )}
      </div>
    </div>
  )
})
