import { describe, it, expect } from 'vitest'
import type { PermissionMode } from '@/cli/types'
import { MODE_OPTIONS, modeLabel, modeFromVoice } from './permissionModes'

describe('permissionModes', () => {
  it('covers exactly the four CLI permission modes, each with a unique 1..4 shortcut', () => {
    const modes = MODE_OPTIONS.map((o) => o.mode).sort()
    expect(modes).toEqual(['acceptEdits', 'bypassPermissions', 'default', 'plan'])
    expect(MODE_OPTIONS.map((o) => o.shortcut).sort()).toEqual([1, 2, 3, 4])
  })

  it('modeLabel is total over PermissionMode', () => {
    const all: PermissionMode[] = ['plan', 'acceptEdits', 'bypassPermissions', 'default']
    for (const m of all) expect(modeLabel(m).length).toBeGreaterThan(0)
  })

  it('modeFromVoice matches TH + EN phrases, longest phrase wins', () => {
    expect(modeFromVoice('โหมดวางแผน')).toBe('plan')
    expect(modeFromVoice('please accept edits now')).toBe('acceptEdits')
    expect(modeFromVoice('บายพาส')).toBe('bypassPermissions')
    expect(modeFromVoice('ask permissions')).toBe('default')
    expect(modeFromVoice('สวัสดี')).toBeNull()
  })
})
