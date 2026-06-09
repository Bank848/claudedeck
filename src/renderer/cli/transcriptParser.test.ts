import { describe, it, expect } from 'vitest'
import { parseTranscript } from './transcriptParser'

const line = (o: unknown) => JSON.stringify(o)

describe('parseTranscript', () => {
  it('skips noise + corrupt lines, keeps user(string) and assistant(blocks)', () => {
    const jsonl = [
      line({ type: 'queue-operation', operation: 'enqueue' }),
      line({ type: 'attachment' }),
      '{ this is corrupt',
      line({ type: 'user', message: { role: 'user', content: 'hello' } }),
      line({ type: 'assistant', message: { role: 'assistant', content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'hi there' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
      ] } }),
      line({ type: 'user', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'file body', is_error: false },
      ] } }),
    ].join('\n')

    const msgs = parseTranscript(jsonl)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    const u = msgs[0]; const a = msgs[1]
    expect(u.parts).toEqual([{ kind: 'markdown', text: 'hello' }])
    expect(a.parts.map((p) => p.kind)).toEqual(['thinking', 'markdown', 'tool'])
    const tool = a.parts.find((p) => p.kind === 'tool') as { call: { status: string; output?: string } }
    expect(tool.call.status).toBe('done')
    expect(tool.call.output).toBe('file body')
    expect(a.streaming).toBeFalsy()
  })

  it('returns [] for empty / all-noise input (never throws)', () => {
    expect(parseTranscript('')).toEqual([])
    expect(parseTranscript('not json\n{"type":"system"}')).toEqual([])
  })
})
