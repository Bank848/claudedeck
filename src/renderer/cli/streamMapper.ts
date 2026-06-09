import type { ChatMessage, MessagePart, ToolCall } from '@/mock/fixtures'
import type { ClaudeEvent, TurnUsage } from './types'
import { blockToPart, resultText } from './blockMapping'

export interface FoldResult {
  message: ChatMessage
  sessionId?: string
  finalized?: boolean
  errored?: boolean
  usage?: TurnUsage
}

export function emptyAssistantMessage(id: string, createdAt: string): ChatMessage {
  return { id, role: 'assistant', createdAt, parts: [], streaming: true }
}

/** Pure fold: apply one stream-json event to the in-progress assistant message. */
export function foldEvent(message: ChatMessage, event: ClaudeEvent): FoldResult {
  switch (event.type) {
    case 'system':
      return { message, sessionId: event.session_id }

    case 'assistant': {
      const parts = [...message.parts]
      for (const block of event.message.content) {
        const part = blockToPart(block, 'running')
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

    case 'result': {
      const u = event.usage ?? {}
      const usage: TurnUsage = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheCreation: u.cache_creation_input_tokens ?? 0,
      }
      return { message: { ...message, streaming: false }, sessionId: event.session_id, finalized: true, errored: !!event.is_error, usage }
    }

    default:
      return { message }
  }
}
