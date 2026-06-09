import type { ChatMessage, MessagePart, ToolCall } from '@/mock/fixtures'
import type { ContentBlock, ToolResultBlock, ToolResultContent } from './types'

const NOISE = new Set(['queue-operation', 'attachment', 'last-prompt', 'system'])

function toolLabel(name: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>
  for (const k of ['file_path', 'path', 'pattern', 'command', 'url', 'query'] as const) {
    if (typeof o[k] === 'string' && o[k]) return o[k] as string
  }
  return name
}
function blockToPart(block: ContentBlock): MessagePart | null {
  switch (block.type) {
    case 'text': return { kind: 'markdown', text: block.text }
    case 'thinking': return { kind: 'thinking', text: block.thinking }
    case 'tool_use':
      return { kind: 'tool', call: { id: block.id, tool: block.name, label: toolLabel(block.name, block.input), status: 'done', input: block.input } }
    default: return null
  }
}
function resultText(content: ToolResultContent): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((c) => (c.type === 'text' && typeof (c as { text?: string }).text === 'string' ? (c as { text: string }).text : '')).filter(Boolean).join('\n')
  }
  return ''
}

/** Apply historical tool_result blocks onto the most recent assistant tool parts. */
function applyToolResults(messages: ChatMessage[], results: ToolResultBlock[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    m.parts = m.parts.map((p): MessagePart => {
      if (p.kind !== 'tool') return p
      const res = results.find((r) => r.tool_use_id === p.call.id)
      if (!res) return p
      const call: ToolCall = { ...p.call, status: res.is_error ? 'error' : 'done', output: resultText(res.content) }
      return { kind: 'tool', call }
    })
    break
  }
}

export function parseTranscript(jsonl: string): ChatMessage[] {
  const out: ChatMessage[] = []
  let n = 0
  for (const raw of jsonl.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    let o: { type?: string; message?: { role?: string; content?: unknown } }
    try { o = JSON.parse(line) } catch { continue }
    if (!o.type || NOISE.has(o.type)) continue
    const content = o.message?.content
    if (o.type === 'user') {
      if (typeof content === 'string') {
        out.push({ id: `h-${n++}`, role: 'user', createdAt: '', parts: [{ kind: 'markdown', text: content }] })
      } else if (Array.isArray(content)) {
        const results = content.filter((c): c is ToolResultBlock => !!c && (c as { type?: string }).type === 'tool_result')
        if (results.length) applyToolResults(out, results)
      }
    } else if (o.type === 'assistant' && Array.isArray(content)) {
      const parts = content.map((b) => blockToPart(b as ContentBlock)).filter((p): p is MessagePart => p !== null)
      out.push({ id: `h-${n++}`, role: 'assistant', createdAt: '', parts, streaming: false })
    }
  }
  return out
}
