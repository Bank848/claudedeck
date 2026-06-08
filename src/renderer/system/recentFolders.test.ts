import { describe, it, expect } from 'vitest'
import { addRecent, folderLabel } from './recentFolders'

describe('addRecent', () => {
  it('prepends new path', () => {
    expect(addRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })
  it('moves existing to front (dedupe)', () => {
    expect(addRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })
  it('ignores blank', () => {
    expect(addRecent(['a'], '  ')).toEqual(['a'])
  })
  it('caps at 12', () => {
    const many = Array.from({ length: 12 }, (_, i) => `d${i}`)
    expect(addRecent(many, 'new')).toHaveLength(12)
    expect(addRecent(many, 'new')[0]).toBe('new')
  })
})

describe('folderLabel', () => {
  it('last segment, windows', () => {
    expect(folderLabel('D:\\Claudec Code CLI App')).toBe('Claudec Code CLI App')
  })
  it('last segment, posix + trailing slash', () => {
    expect(folderLabel('/home/me/proj/')).toBe('proj')
  })
  it('empty → No folder', () => {
    expect(folderLabel('')).toBe('No folder')
  })
})
