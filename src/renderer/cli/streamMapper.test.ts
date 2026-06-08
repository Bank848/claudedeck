import { describe, it, expect } from 'vitest'
import { foldEvent, emptyAssistantMessage } from './streamMapper'
import type { ClaudeEvent } from './types'

function fold(events: ClaudeEvent[]) {
  let msg = emptyAssistantMessage('a1', '2026-06-08T00:00:00Z')
  let sessionId: string | undefined
  let finalized = false
  let errored = false
  for (const e of events) {
    const r = foldEvent(msg, e)
    msg = r.message
    sessionId = r.sessionId ?? sessionId
    finalized = r.finalized ?? finalized
    errored = r.errored ?? errored
  }
  return { msg, sessionId, finalized, errored }
}

describe('foldEvent', () => {
  it('preserves the raw tool_use input on the tool call', () => {
    const msg = emptyAssistantMessage('a1', '2026-06-08T00:00:00Z')
    const event: ClaudeEvent = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'a.ts', content: 'x' } },
        ],
      },
    }
    const { message } = foldEvent(msg, event)
    const part = message.parts[0]
    expect(part.kind).toBe('tool')
    if (part.kind === 'tool') {
      expect(part.call.input).toEqual({ file_path: 'a.ts', content: 'x' })
    }
  })

  it('captures session_id from the init event', () => {
    const { sessionId } = fold([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
    ])
    expect(sessionId).toBe('sess-1')
  })

  it('folds plain assistant text into a markdown part', () => {
    const { msg } = fold([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] } },
    ])
    expect(msg.parts).toEqual([{ kind: 'markdown', text: 'Hello!' }])
  })

  it('folds a tool_use → tool_result round-trip into a resolved tool card', () => {
    const { msg } = fold([
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'src/app.ts' } },
      ] } },
      { type: 'user', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false },
      ] } },
    ])
    expect(msg.parts).toHaveLength(1)
    expect(msg.parts[0]).toEqual({
      kind: 'tool',
      call: { id: 'tu1', tool: 'Read', label: 'src/app.ts', status: 'done', output: 'file contents', input: { file_path: 'src/app.ts' } },
    })
  })

  it('marks a tool card errored when tool_result.is_error', () => {
    const { msg } = fold([
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'npm test' } },
      ] } },
      { type: 'user', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu2', content: 'boom', is_error: true },
      ] } },
    ])
    const part = msg.parts[0]
    expect(part.kind === 'tool' && part.call.status).toBe('error')
    expect(part.kind === 'tool' && part.call.label).toBe('npm test')
  })

  it('keeps interleaved order: text, tool, text', () => {
    const { msg } = fold([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', id: 't', name: 'Grep', input: { pattern: 'foo' } }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] } },
    ])
    expect(msg.parts.map((p) => p.kind)).toEqual(['markdown', 'tool', 'markdown'])
  })

  it('folds thinking blocks', () => {
    const { msg } = fold([
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] } },
    ])
    expect(msg.parts).toEqual([{ kind: 'thinking', text: 'hmm' }])
  })

  it('finalizes on result and flags errors', () => {
    const ok = fold([{ type: 'result', subtype: 'success', is_error: false, session_id: 's' }])
    expect(ok.finalized).toBe(true)
    expect(ok.errored).toBe(false)
    expect(ok.msg.streaming).toBe(false)

    const bad = fold([{ type: 'result', subtype: 'error_during_execution', is_error: true }])
    expect(bad.errored).toBe(true)
  })

  it('is pure — does not mutate the input message', () => {
    const m0 = emptyAssistantMessage('a', 't')
    foldEvent(m0, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } })
    expect(m0.parts).toHaveLength(0)
  })
})
