import type { ChatMessage, MessagePart, ToolCall } from '@/mock/fixtures'
import type { ClaudeEvent, ContentBlock, ToolResultContent } from './types'

export interface FoldResult {
  message: ChatMessage
  sessionId?: string
  finalized?: boolean
  errored?: boolean
}

export function emptyAssistantMessage(id: string, createdAt: string): ChatMessage {
  return { id, role: 'assistant', createdAt, parts: [], streaming: true }
}

/** Best-effort short label from a tool's input, falling back to the tool name. */
function toolLabel(name: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>
  for (const k of ['file_path', 'path', 'pattern', 'command', 'url', 'query'] as const) {
    if (typeof o[k] === 'string' && o[k]) return o[k] as string
  }
  return name
}

function blockToPart(block: ContentBlock): MessagePart | null {
  switch (block.type) {
    case 'text':
      return { kind: 'markdown', text: block.text }
    case 'thinking':
      return { kind: 'thinking', text: block.thinking }
    case 'tool_use':
      return {
        kind: 'tool',
        call: { id: block.id, tool: block.name, label: toolLabel(block.name, block.input), status: 'running' },
      }
    default:
      return null
  }
}

function resultText(content: ToolResultContent): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (c.type === 'text' && typeof (c as { text?: string }).text === 'string' ? (c as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** Pure fold: apply one stream-json event to the in-progress assistant message. */
export function foldEvent(message: ChatMessage, event: ClaudeEvent): FoldResult {
  switch (event.type) {
    case 'system':
      return { message, sessionId: event.session_id }

    case 'assistant': {
      const parts = [...message.parts]
      for (const block of event.message.content) {
        const part = blockToPart(block)
        if (part) parts.push(part)
      }
      return { message: { ...message, parts }, sessionId: event.session_id }
    }

    case 'user': {
      const parts = message.parts.map((p): MessagePart => {
        if (p.kind !== 'tool') return p
        const res = event.message.content.find((c) => c.tool_use_id === p.call.id)
        if (!res) return p
        const call: ToolCall = {
          ...p.call,
          status: res.is_error ? 'error' : 'done',
          output: resultText(res.content),
        }
        return { kind: 'tool', call }
      })
      return { message: { ...message, parts }, sessionId: event.session_id }
    }

    case 'result':
      return {
        message: { ...message, streaming: false },
        sessionId: event.session_id,
        finalized: true,
        errored: !!event.is_error,
      }

    default:
      return { message }
  }
}
