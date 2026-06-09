import { describe, it, expect } from 'vitest'
import { slugify, defaultForkBranch, isValidBranchName } from './forkSession'
import { isValidRef } from '../../../electron/git'

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('Fix the Auth Bug!')).toBe('fix-the-auth-bug')
  })
  it('collapses and trims dashes', () => {
    expect(slugify('  a   b  ')).toBe('a-b')
  })
  it('caps length without a trailing dash', () => {
    expect(slugify('x'.repeat(60)).length).toBeLessThanOrEqual(40)
    expect(slugify('aaaa '.repeat(20)).endsWith('-')).toBe(false)
  })
})

describe('defaultForkBranch', () => {
  const now = new Date(2026, 5, 10, 0, 38, 47) // 2026-06-10 00:38:47 local
  it('derives a fork/<slug> from the seed', () => {
    expect(defaultForkBranch('Refactor the session reducer', now)).toBe('fork/refactor-the-session-reducer')
  })
  it('uses a timestamp when the seed is empty', () => {
    expect(defaultForkBranch('   ', now)).toBe('fork/20260610-003847')
  })
  it('produces names that pass the main-process isValidRef guard', () => {
    expect(isValidRef(defaultForkBranch('Fix the Auth Bug!', now))).toBe(true)
    expect(isValidRef(defaultForkBranch('', now))).toBe(true)
  })
})

describe('isValidBranchName', () => {
  it('accepts fork/slug, rejects spaces / leading dash / ..', () => {
    expect(isValidBranchName('fork/fix-auth')).toBe(true)
    expect(isValidBranchName('has space')).toBe(false)
    expect(isValidBranchName('-leading')).toBe(false)
    expect(isValidBranchName('a..b')).toBe(false)
  })
})
