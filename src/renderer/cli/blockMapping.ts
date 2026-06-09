import type { MessagePart, ToolStatus } from '@/mock/fixtures'
import type { ContentBlock, ToolResultContent } from './types'

/**
 * Shared mapping from claude content blocks → ClaudeDeck message parts. Used by
 * both the live stream fold (streamMapper) and the historical transcript parse
 * (transcriptParser) so the two render identically and can't drift.
 */

/** Best-effort short label from a tool's input, falling back to the tool name. */
export function toolLabel(name: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>
  for (const k of ['file_path', 'path', 'pattern', 'command', 'url', 'query'] as const) {
    if (typeof o[k] === 'string' && o[k]) return o[k] as string
  }
  return name
}

/**
 * Convert one content block to a message part. `status` seeds a tool_use's
 * state: 'running' for the live stream, 'done' for a replayed transcript.
 */
export function blockToPart(block: ContentBlock, status: ToolStatus): MessagePart | null {
  switch (block.type) {
    case 'text':
      return { kind: 'markdown', text: block.text }
    case 'thinking':
      return { kind: 'thinking', text: block.thinking }
    case 'tool_use':
      return {
        kind: 'tool',
        call: { id: block.id, tool: block.name, label: toolLabel(block.name, block.input), status, input: block.input },
      }
    default:
      return null
  }
}

/** Flatten a tool_result's content (string or text blocks) to a plain string. */
export function resultText(content: ToolResultContent): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (c.type === 'text' && typeof (c as { text?: string }).text === 'string' ? (c as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}
