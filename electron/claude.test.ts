import { describe, it, expect } from 'vitest'
import { buildArgs, toCliModel, toCliEffort, pickCwd } from './claude'
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

  it('omits --model when no id given', () => {
    expect(toCliModel(undefined)).toBeUndefined()
    expect(toCliModel('')).toBeUndefined()
  })

  it('passes through an already-valid alias/full id', () => {
    expect(toCliModel('opus')).toBe('opus')
    expect(toCliModel('claude-opus-4-8')).toBe('claude-opus-4-8')
  })
})

describe('toCliEffort (whitelist before argv)', () => {
  it('passes through every valid level', () => {
    for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(toCliEffort(e)).toBe(e)
    }
  })

  it('drops unknown / empty values', () => {
    expect(toCliEffort('bogus')).toBeUndefined()
    expect(toCliEffort('')).toBeUndefined()
    expect(toCliEffort(undefined)).toBeUndefined()
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

  it('includes the core stream-json flags and permission mode', () => {
    const args = buildArgs(base)
    expect(args.slice(0, 5)).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode',
    ])
    expect(args[5]).toBe('plan')
  })

  it('adds --effort only for a valid level, and never a bogus one', () => {
    expect(buildArgs(base)).not.toContain('--effort')
    const hi = buildArgs({ ...base, effort: 'high' })
    const i = hi.indexOf('--effort')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(hi[i + 1]).toBe('high')
    // An unknown value is dropped — the flag is omitted so the CLI defaults.
    const bad = buildArgs({ ...base, effort: 'bogus' })
    expect(bad).not.toContain('--effort')
    expect(bad).not.toContain('bogus')
  })

  it('passes auto and dontAsk through --permission-mode unchanged', () => {
    for (const m of ['auto', 'dontAsk'] as const) {
      const args = buildArgs({ ...base, permissionMode: m })
      const i = args.indexOf('--permission-mode')
      expect(args[i + 1]).toBe(m)
    }
  })

  it('emits --allowedTools / --disallowedTools as separate tokens, skips when empty', () => {
    expect(buildArgs(base)).not.toContain('--allowedTools')
    expect(buildArgs(base)).not.toContain('--disallowedTools')
    const a = buildArgs({
      ...base,
      allowedTools: ['Bash(git *)', 'Edit', '  '],
      disallowedTools: ['WebFetch'],
    })
    const ai = a.indexOf('--allowedTools')
    expect(ai).toBeGreaterThanOrEqual(0)
    // One rule = one argv token (no shell parse): the space inside the pattern stays.
    expect(a[ai + 1]).toBe('Bash(git *)')
    expect(a[ai + 2]).toBe('Edit')
    expect(a).not.toContain('  ') // empty rule dropped
    const di = a.indexOf('--disallowedTools')
    expect(di).toBeGreaterThanOrEqual(0)
    expect(a[di + 1]).toBe('WebFetch')
  })

  it('emits each additional dir as an --add-dir token, skips empties', () => {
    expect(buildArgs(base)).not.toContain('--add-dir')
    const a = buildArgs({ ...base, additionalDirs: ['D:/lib', '  ', 'D:/shared'] })
    const i = a.indexOf('--add-dir')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(a.slice(i + 1, i + 3)).toEqual(['D:/lib', 'D:/shared'])
  })

  it('emits the settings object as a single --settings JSON token; omits when empty', () => {
    expect(buildArgs(base)).not.toContain('--settings')
    expect(buildArgs({ ...base, settings: {} })).not.toContain('--settings')
    const a = buildArgs({ ...base, settings: { allow: ['Edit'], defaultMode: 'acceptEdits' } })
    const i = a.indexOf('--settings')
    expect(i).toBeGreaterThanOrEqual(0)
    // The JSON is ONE argv token — it never hits a shell.
    const parsed = JSON.parse(a[i + 1])
    expect(parsed.permissions.allow).toEqual(['Edit'])
    expect(parsed.permissions.defaultMode).toBe('acceptEdits')
  })

  it('emits --setting-sources only when provided, independent of settings', () => {
    expect(buildArgs(base)).not.toContain('--setting-sources')
    const a = buildArgs({ ...base, settingSources: 'user,project,local' })
    const i = a.indexOf('--setting-sources')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(a[i + 1]).toBe('user,project,local')
  })

  it('adds --resume only when a sessionId is present', () => {
    expect(buildArgs(base)).not.toContain('--resume')
    const resumed = buildArgs({ ...base, sessionId: 'sess-9' })
    const i = resumed.indexOf('--resume')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(resumed[i + 1]).toBe('sess-9')
  })

  it('runs in stream-json input mode with the stdio permission-prompt tool (P5)', () => {
    const args = buildArgs(base)
    const i = args.indexOf('--input-format')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('stream-json')
    const p = args.indexOf('--permission-prompt-tool')
    expect(p).toBeGreaterThanOrEqual(0)
    expect(args[p + 1]).toBe('stdio')
  })

  it('never puts the prompt in argv — it goes over stdin (B3 regression)', () => {
    // A prompt full of cmd.exe metacharacters must not appear anywhere in argv,
    // so cmd can never parse it. The prompt reaches claude via stdin instead.
    const nasty = 'list a & calc | echo "x" > y'
    const args = buildArgs({ ...base, prompt: nasty })
    expect(args).not.toContain(nasty)
    expect(args.some((t) => t.includes('calc') || t.includes('&'))).toBe(false)
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
