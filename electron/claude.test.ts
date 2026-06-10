import { describe, it, expect } from 'vitest'
import { buildArgs, toCliModel, toCliMode, toCliEffort, pickCwd, classifyLine, cleanRules } from './claude'
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
    expect(toCliModel('fable-5')).toBe('claude-fable-5')
  })

  it('omits --model when no id given', () => {
    expect(toCliModel(undefined)).toBeUndefined()
    expect(toCliModel('')).toBeUndefined()
  })

  it('passes through an already-valid alias/full id', () => {
    expect(toCliModel('opus')).toBe('opus')
    expect(toCliModel('claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('drops an unknown / attacker-supplied id (whitelist, CRIT-1)', () => {
    expect(toCliModel('a&calc')).toBeUndefined()
    expect(toCliModel('bogus-model')).toBeUndefined()
    expect(toCliModel('opus-4-8 & calc.exe')).toBeUndefined()
  })
})

describe('toCliMode (whitelist before --permission-mode)', () => {
  it('passes through every valid mode', () => {
    for (const m of ['plan', 'acceptEdits', 'bypassPermissions', 'default', 'auto', 'dontAsk']) {
      expect(toCliMode(m)).toBe(m)
    }
  })

  it('falls back to default for unknown / attacker values', () => {
    expect(toCliMode('evil&x')).toBe('default')
    expect(toCliMode('')).toBe('default')
    expect(toCliMode(undefined)).toBe('default')
  })
})

describe('cleanRules (% reject — CRIT-1)', () => {
  it('drops any token containing % (would throw in quoteForCmd)', () => {
    expect(cleanRules(['Bash(git *)', '%PATH%', 'Edit'])).toEqual(['Bash(git *)', 'Edit'])
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

  it('falls back to default for an attacker-supplied permission mode (CRIT-1)', () => {
    const args = buildArgs({ ...base, permissionMode: 'evil&x' as never })
    const i = args.indexOf('--permission-mode')
    expect(args[i + 1]).toBe('default')
    expect(args).not.toContain('evil&x')
  })

  it('drops --setting-sources / --resume when the value contains % (CRIT-1)', () => {
    const a = buildArgs({ ...base, settingSources: 'user,%evil%', sessionId: 'sess-%x%' })
    expect(a).not.toContain('--setting-sources')
    expect(a).not.toContain('--resume')
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

  it('adds --fork-session only when forking a resumed session', () => {
    // No fork flag without a session id, and not unless forkSession is set.
    expect(buildArgs({ ...base, forkSession: true })).not.toContain('--fork-session')
    expect(buildArgs({ ...base, sessionId: 'sess-9' })).not.toContain('--fork-session')
    const forked = buildArgs({ ...base, sessionId: 'sess-9', forkSession: true })
    expect(forked).toContain('--resume')
    expect(forked).toContain('--fork-session')
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

describe('classifyLine (#3 — one place to interpret a stream-json line)', () => {
  it('returns null for blank / whitespace-only lines', () => {
    expect(classifyLine('')).toBeNull()
    expect(classifyLine('   ')).toBeNull()
    expect(classifyLine('\t')).toBeNull()
  })

  it('routes malformed JSON to stderr (never throws)', () => {
    expect(classifyLine('not json {')).toEqual({ kind: 'stderr', text: 'not json {' })
  })

  it('extracts a can_use_tool control request as a permission action', () => {
    const line = JSON.stringify({
      type: 'control_request',
      request_id: 'req-7',
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } },
    })
    const action = classifyLine(line)
    expect(action?.kind).toBe('permission')
    if (action?.kind === 'permission') {
      expect(action.req).toEqual({ id: 'req-7', tool: 'Bash', input: { command: 'ls' }, toolUseId: undefined })
    }
  })

  it('drops the CLI’s own control frames (e.g. initialize response)', () => {
    const line = JSON.stringify({ type: 'control_response', response: { subtype: 'success' } })
    expect(classifyLine(line)).toEqual({ kind: 'drop' })
  })

  it('forwards a normal event with isResult=false', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [] } })
    const action = classifyLine(line)
    expect(action?.kind).toBe('event')
    if (action?.kind === 'event') expect(action.isResult).toBe(false)
  })

  it('marks the result event so the caller can close stdin / knows it is the final line', () => {
    // The exact line that abnormal exits can drop (no trailing newline) — usage/cost
    // lives here, so the exit-flush MUST be able to recover it.
    const line = JSON.stringify({ type: 'result', is_error: false, usage: { output_tokens: 5 } })
    const action = classifyLine(line)
    expect(action?.kind).toBe('event')
    if (action?.kind === 'event') {
      expect(action.isResult).toBe(true)
      expect(action.event).toMatchObject({ type: 'result' })
    }
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
