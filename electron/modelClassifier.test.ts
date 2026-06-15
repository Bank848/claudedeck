import { describe, it, expect } from 'vitest'
import { parseClassifierResult, buildClassifyArgs, type Tier } from './modelClassifier'

describe('parseClassifierResult (strict allow-list; unmatched → resting, never fable)', () => {
  it('parses a bare tier word', () => {
    expect(parseClassifierResult('opus', 'haiku')).toBe('opus')
    expect(parseClassifierResult('haiku', 'opus')).toBe('haiku')
  })

  it('fable is no longer a tier → resting (Fable banned, removed from allow-list)', () => {
    expect(parseClassifierResult('fable', 'opus')).toBe('opus')
    expect(parseClassifierResult('fable', 'sonnet')).toBe('sonnet')
  })

  it('tolerates casing / punctuation / surrounding whitespace', () => {
    expect(parseClassifierResult('  Opus.\n', 'haiku')).toBe('opus')
    expect(parseClassifierResult('SONNET', 'opus')).toBe('sonnet')
  })

  it('extracts the tier word from a full sentence', () => {
    expect(parseClassifierResult('I would route this to opus, it is complex.', 'haiku')).toBe('opus')
  })

  it('empty / undefined / is_error result → resting tier', () => {
    expect(parseClassifierResult(undefined, 'sonnet')).toBe('sonnet')
    expect(parseClassifierResult('', 'sonnet')).toBe('sonnet')
  })

  it('garbage / out-of-set word → resting tier (never fable)', () => {
    expect(parseClassifierResult('banana', 'opus')).toBe('opus')
    expect(parseClassifierResult('the answer is gpt', 'haiku')).toBe('haiku')
  })

  it('does not match a tier name embedded in a larger word', () => {
    expect(parseClassifierResult('operassonnetish', 'opus')).toBe('opus')
  })

  it('returns one of the three live tiers for every input', () => {
    const out: Tier = parseClassifierResult('whatever', 'opus')
    expect(['haiku', 'sonnet', 'opus']).toContain(out)
  })
})

describe('buildClassifyArgs (one-shot Haiku — no permission protocol, no resume)', () => {
  const args = buildClassifyArgs()

  it('uses stream-json in and out, on haiku, in print mode', () => {
    expect(args).toEqual(
      expect.arrayContaining(['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--model', 'haiku']),
    )
  })

  it('does NOT start the permission protocol (the one-shot has no tools)', () => {
    expect(args).not.toContain('--permission-prompt-tool')
  })

  it('does NOT resume any session (no transcript, no side effects)', () => {
    expect(args).not.toContain('--resume')
  })
})
