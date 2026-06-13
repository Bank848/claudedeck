import { describe, it, expect } from 'vitest'
import type { Session } from '@/mock/fixtures'
import { indicatorKind, indicatorLabel } from './sessionIndicator'

function s(partial: Partial<Session>): Session {
  return {
    id: 'x', title: 't', cwd: '', status: 'idle', model: 'opus-4-8',
    updatedAt: '', tokens: 0, messages: [], terminalLines: [], ...partial,
  }
}

describe('indicatorKind precedence', () => {
  it('needsInput beats everything (even error + running)', () => {
    expect(indicatorKind(s({ attention: 'needsInput', status: 'error' }))).toBe('needsInput')
    expect(indicatorKind(s({ attention: 'needsInput', status: 'running' }))).toBe('needsInput')
  })
  it('error beats unread and status', () => {
    expect(indicatorKind(s({ attention: 'unread', status: 'error' }))).toBe('error')
    expect(indicatorKind(s({ status: 'error' }))).toBe('error')
  })
  it('unread beats plain status', () => {
    expect(indicatorKind(s({ attention: 'unread', status: 'idle' }))).toBe('unread')
    expect(indicatorKind(s({ attention: 'unread', status: 'running' }))).toBe('unread')
  })
  it('falls back to status when no attention/error', () => {
    expect(indicatorKind(s({ status: 'running' }))).toBe('running')
    expect(indicatorKind(s({ status: 'idle' }))).toBe('idle')
    expect(indicatorKind(s({ status: 'active' }))).toBe('active')
  })
})

describe('indicatorLabel', () => {
  it('gives an English word per kind (for aria/sr-only)', () => {
    expect(indicatorLabel(s({ attention: 'needsInput' }))).toBe('needs input')
    expect(indicatorLabel(s({ attention: 'unread', status: 'idle' }))).toBe('unread')
    expect(indicatorLabel(s({ status: 'error' }))).toBe('error')
    expect(indicatorLabel(s({ status: 'running' }))).toBe('running')
    expect(indicatorLabel(s({ status: 'idle' }))).toBe('idle')
  })
})
