import { describe, it, expect } from 'vitest'
import { buildArgs, toCliModel, pickCwd } from './claude'
import type { StartTurnArgs } from './claude'

const base: StartTurnArgs = {
  turnId: 't1',
  prompt: 'list two colors',
  cwd: 'D:/projects/web-app',
  permissionMode: 'plan',
}

describe('toCliModel (B2 — fixture id → valid --model)', () => {
  it('maps ClaudeDeck ids to CLI aliases', () => {
    expect(toCliModel('opus-4-8')).toBe('opus')
    expect(toCliModel('sonnet-4-6')).toBe('sonnet')
    expect(toCliModel('haiku-4-5')).toBe('haiku')
  })

  it('omits --model for codex ids (not claude models)', () => {
    expect(toCliModel('codex-gpt-5')).toBeUndefined()
    expect(toCliModel('codex-mini')).toBeUndefined()
  })

  it('omits --model when no id given', () => {
    expect(toCliModel(undefined)).toBeUndefined()
    expect(toCliModel('')).toBeUndefined()
  })

  it('passes through an already-valid alias/full id', () => {
    expect(toCliModel('opus')).toBe('opus')
    expect(toCliModel('claude-opus-4-8')).toBe('claude-opus-4-8')
  })
})

describe('buildArgs', () => {
  it('never emits the raw fixture id as --model (B2 regression)', () => {
    const args = buildArgs({ ...base, model: 'opus-4-8' })
    expect(args).not.toContain('opus-4-8')
    const i = args.indexOf('--model')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('opus')
  })

  it('drops --model entirely for codex selections', () => {
    expect(buildArgs({ ...base, model: 'codex-gpt-5' })).not.toContain('--model')
  })

  it('includes the core stream-json flags and permission mode', () => {
    const args = buildArgs(base)
    expect(args.slice(0, 6)).toEqual([
      '-p', 'list two colors', '--output-format', 'stream-json', '--verbose', '--permission-mode',
    ])
    expect(args[6]).toBe('plan')
  })

  it('adds --resume only when a sessionId is present', () => {
    expect(buildArgs(base)).not.toContain('--resume')
    const resumed = buildArgs({ ...base, sessionId: 'sess-9' })
    const i = resumed.indexOf('--resume')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(resumed[i + 1]).toBe('sess-9')
  })

  it('passes the prompt as a discrete argv element (no shell concat)', () => {
    const args = buildArgs({ ...base, prompt: 'a & b "quoted"' })
    expect(args).toContain('a & b "quoted"')
  })
})

describe('pickCwd (B1 — fall back when cwd is missing)', () => {
  const fallback = 'D:/real/fallback'

  it('keeps the requested cwd when it exists', () => {
    expect(pickCwd('D:/projects/web-app', fallback, () => true)).toBe('D:/projects/web-app')
  })

  it('falls back when the requested cwd does not exist', () => {
    expect(pickCwd('D:/projects/web-app', fallback, () => false)).toBe(fallback)
  })

  it('falls back when no cwd was requested', () => {
    expect(pickCwd(undefined, fallback, () => true)).toBe(fallback)
    expect(pickCwd('', fallback, () => true)).toBe(fallback)
  })
})
