import type { MessagePart, ToolStatus, SpawnChipData } from '@/mock/fixtures'
import type { ContentBlock, ToolResultContent } from './types'

/** Wire name of ClaudeDeck's injected MCP tool. MUST match electron/claude.ts SPAWN_TASK_TOOL. */
export const SPAWN_TASK_TOOL_NAME = 'mcp__claudedeck__spawn_task'

/** Parse a spawn_task tool_use input into chip data; null when there's no usable prompt. */
export function spawnChipFromInput(id: string, input: unknown): SpawnChipData | null {
  const o = (input ?? {}) as Record<string, unknown>
  const prompt = typeof o.prompt === 'string' ? o.prompt : ''
  if (!prompt.trim()) return null
  return {
    toolUseId: id,
    title: typeof o.title === 'string' && o.title.trim() ? o.title : 'Spawn task',
    prompt,
    tldr: typeof o.tldr === 'string' ? o.tldr : '',
    cwd: typeof o.cwd === 'string' && o.cwd ? o.cwd : undefined,
  }
}

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
    case 'tool_use': {
      if (block.name === SPAWN_TASK_TOOL_NAME) {
        const chip = spawnChipFromInput(block.id, block.input)
        return chip ? { kind: 'spawn-chip', chip } : null
      }
      return {
        kind: 'tool',
        call: { id: block.id, tool: block.name, label: toolLabel(block.name, block.input), status, input: block.input },
      }
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
