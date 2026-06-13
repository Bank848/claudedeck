import { describe, it, expect } from 'vitest'
import { deriveSessionTitle, isDefaultTitle, DEFAULT_TITLE } from './sessionTitle'

describe('isDefaultTitle', () => {
  it('treats the placeholder, blank, and whitespace as unnamed', () => {
    expect(isDefaultTitle(DEFAULT_TITLE)).toBe(true)
    expect(isDefaultTitle('')).toBe(true)
    expect(isDefaultTitle('   ')).toBe(true)
    expect(isDefaultTitle(undefined)).toBe(true)
  })
  it('treats any real title as named', () => {
    expect(isDefaultTitle('Fix the timer')).toBe(false)
    expect(isDefaultTitle('New session (fork)')).toBe(false)
  })
})

describe('deriveSessionTitle', () => {
  it('uses the first non-empty line', () => {
    expect(deriveSessionTitle('\n\n  Add a running timer  \nmore text')).toBe('Add a running timer')
  })

  it('strips common markdown markers', () => {
    expect(deriveSessionTitle('## Heading here')).toBe('Heading here')
    expect(deriveSessionTitle('- a bullet point')).toBe('a bullet point')
    expect(deriveSessionTitle('> quoted ask')).toBe('quoted ask')
    expect(deriveSessionTitle('use `useEffect` and *bold*')).toBe('use useEffect and bold')
  })

  it('truncates long text on a word boundary with an ellipsis', () => {
    const long = 'please help me build a beautiful elapsed time indicator for every running turn'
    const out = deriveSessionTitle(long)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(49)
    expect(out).not.toContain('  ')
  })

  it('returns empty for unusable input so the caller keeps the placeholder', () => {
    expect(deriveSessionTitle('')).toBe('')
    expect(deriveSessionTitle('   \n  ')).toBe('')
  })

  it('keeps a long unbroken token as a hard cut rather than dropping it all', () => {
    const url = 'https://example.com/a/very/long/path/that/has/no/spaces/anywhere/at/all'
    const out = deriveSessionTitle(url)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeGreaterThan(10)
  })
})
