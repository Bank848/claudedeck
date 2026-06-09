import { describe, it, expect } from 'vitest'
import {
  parseBranch,
  parseBranches,
  parseStatus,
  parseWorktrees,
  isValidRef,
  forkWorktreePath,
} from './git'

describe('parseBranch', () => {
  it('returns first trimmed line', () => {
    expect(parseBranch('main\n')).toBe('main')
  })
  it('returns HEAD when detached', () => {
    expect(parseBranch('HEAD\nC:/repo/.git\n')).toBe('HEAD')
  })
})

describe('parseBranches', () => {
  it('splits and drops blanks', () => {
    expect(parseBranches('main\nfeature\n\n  dev  \n')).toEqual(['main', 'feature', 'dev'])
  })
  it('empty input → []', () => {
    expect(parseBranches('')).toEqual([])
  })
})

describe('parseStatus', () => {
  it('clean main, not a worktree', () => {
    expect(parseStatus('main\nC:/repo/.git', '')).toEqual({
      branch: 'main',
      isWorktree: false,
      isDirty: false,
    })
  })
  it('dirty + linked worktree (windows path)', () => {
    expect(parseStatus('feat\nC:\\repo\\.git\\worktrees\\feat', ' M file.ts\n')).toEqual({
      branch: 'feat',
      isWorktree: true,
      isDirty: true,
    })
  })
})

describe('parseWorktrees', () => {
  it('parses porcelain blocks incl. detached', () => {
    const out = [
      'worktree /repo',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree /repo/.wt/feat',
      'HEAD def',
      'branch refs/heads/feat',
      '',
      'worktree /repo/.wt/dt',
      'HEAD 111',
      'detached',
      '',
    ].join('\n')
    expect(parseWorktrees(out)).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/repo/.wt/feat', branch: 'feat' },
      { path: '/repo/.wt/dt', branch: '(detached)' },
    ])
  })
})

describe('isValidRef', () => {
  it('accepts normal names', () => {
    expect(isValidRef('main')).toBe(true)
    expect(isValidRef('feature/x_1')).toBe(true)
  })
  it('rejects flags, spaces, traversal, refspec chars', () => {
    expect(isValidRef('-rf')).toBe(false)
    expect(isValidRef('a b')).toBe(false)
    expect(isValidRef('a..b')).toBe(false)
    expect(isValidRef('a~1')).toBe(false)
  })
})

describe('forkWorktreePath', () => {
  it('places a sibling <name>-worktrees dir, slashes dashed', () => {
    expect(forkWorktreePath('/code/ClaudeDeck', 'fork/fix-auth').replace(/\\/g, '/'))
      .toBe('/code/ClaudeDeck-worktrees/fork-fix-auth')
  })
  it('handles a trailing separator on the root', () => {
    expect(forkWorktreePath('/code/ClaudeDeck/', 'fork/x').replace(/\\/g, '/'))
      .toBe('/code/ClaudeDeck-worktrees/fork-x')
  })
  it('uses the leaf dir name for a nested repo root', () => {
    expect(forkWorktreePath('/a/b/myrepo', 'fork/y').replace(/\\/g, '/'))
      .toBe('/a/b/myrepo-worktrees/fork-y')
  })
})
