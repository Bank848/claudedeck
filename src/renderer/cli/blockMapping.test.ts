import { describe, it, expect } from 'vitest'
import { blockToPart, SPAWN_TASK_TOOL_NAME } from './blockMapping'
import type { ToolUseBlock } from './types'

const toolUse = (input: unknown): ToolUseBlock => ({
  type: 'tool_use', id: 'tu_1', name: SPAWN_TASK_TOOL_NAME, input,
})

describe('blockToPart — spawn_task chip detection', () => {
  it('maps a spawn_task tool_use to a spawn-chip part (not a tool card)', () => {
    const part = blockToPart(toolUse({ title: 'Fix docs', prompt: 'Update README', tldr: 'docs' }), 'running')
    expect(part).toEqual({
      kind: 'spawn-chip',
      chip: { toolUseId: 'tu_1', title: 'Fix docs', prompt: 'Update README', tldr: 'docs', cwd: undefined },
    })
  })

  it('carries an explicit cwd through', () => {
    const part = blockToPart(toolUse({ title: 't', prompt: 'p', tldr: 'x', cwd: 'D:/other' }), 'done')
    expect(part).toMatchObject({ kind: 'spawn-chip', chip: { cwd: 'D:/other' } })
  })

  it('renders NO chip when prompt is missing or blank', () => {
    expect(blockToPart(toolUse({ title: 't', tldr: 'x' }), 'running')).toBeNull()
    expect(blockToPart(toolUse({ title: 't', prompt: '   ', tldr: 'x' }), 'running')).toBeNull()
  })

  it('falls back to a sensible title when title is missing', () => {
    const part = blockToPart(toolUse({ prompt: 'p', tldr: 'x' }), 'running')
    expect(part).toMatchObject({ kind: 'spawn-chip', chip: { title: 'Spawn task' } })
  })

  it('still maps ordinary tools to a tool card', () => {
    const part = blockToPart({ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls' } }, 'running')
    expect(part).toMatchObject({ kind: 'tool', call: { tool: 'Bash' } })
  })
})
