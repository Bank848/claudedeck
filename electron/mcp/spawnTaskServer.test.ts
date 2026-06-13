import { describe, it, expect } from 'vitest'
import {
  SPAWN_TASK_TOOL_DEF,
  buildSpawnTaskCallResult,
  dispatch,
} from './spawnTaskServer'

describe('spawnTaskServer — tool definition', () => {
  it('exposes a spawn_task tool requiring title/prompt/tldr', () => {
    expect(SPAWN_TASK_TOOL_DEF.name).toBe('spawn_task')
    expect(SPAWN_TASK_TOOL_DEF.inputSchema.required).toEqual(['title', 'prompt', 'tldr'])
  })
})

describe('buildSpawnTaskCallResult — success payload (signal carrier)', () => {
  it('returns a non-error content payload with a stable task id', () => {
    const r = buildSpawnTaskCallResult({ title: 'Fix docs', prompt: 'p', tldr: 't' }, 0)
    expect(r.isError).toBeUndefined()
    expect(r.content[0].type).toBe('text')
    expect(r.content[0].text).toContain('Fix docs')
    expect(r.content[0].text).toMatch(/task_/)
  })

  it('tolerates a missing title', () => {
    const r = buildSpawnTaskCallResult({} as never, 0)
    expect(r.content[0].text).toBeTruthy()
  })
})

describe('dispatch — minimal MCP JSON-RPC', () => {
  it('answers initialize with tools capability + serverInfo', () => {
    const res = dispatch({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} })
    expect(res).toMatchObject({ id: 0, result: { serverInfo: { name: 'claudedeck' } } })
    expect((res as { result: { capabilities: { tools: unknown } } }).result.capabilities.tools).toBeDefined()
  })

  it('lists the spawn_task tool', () => {
    const res = dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as
      { result: { tools: Array<{ name: string }> } }
    expect(res.result.tools.map((t) => t.name)).toContain('spawn_task')
  })

  it('returns success for a tools/call of spawn_task', () => {
    const res = dispatch({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'spawn_task', arguments: { title: 'X', prompt: 'p', tldr: 't' } },
    }) as { result: { content: Array<{ text: string }> } }
    expect(res.result.content[0].text).toContain('X')
  })

  it('ignores notifications (no id) by returning null', () => {
    expect(dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('returns method-not-found for an unknown request', () => {
    const res = dispatch({ jsonrpc: '2.0', id: 9, method: 'resources/list' }) as
      { error: { code: number } }
    expect(res.error.code).toBe(-32601)
  })
})
