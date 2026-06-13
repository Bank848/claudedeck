import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveSpawnCwd, canAct, getChipStatus, setChipStatus, resetChipStatuses,
} from './spawnChipLogic'

beforeEach(() => resetChipStatuses())

describe('resolveSpawnCwd', () => {
  it('prefers the chip cwd, falls back to the session cwd', () => {
    expect(resolveSpawnCwd('D:/chip', 'D:/session')).toBe('D:/chip')
    expect(resolveSpawnCwd(undefined, 'D:/session')).toBe('D:/session')
    expect(resolveSpawnCwd('', 'D:/session')).toBe('D:/session')
  })
})

describe('canAct', () => {
  it('only pending chips have active buttons', () => {
    expect(canAct('pending')).toBe(true)
    expect(canAct('spawned')).toBe(false)
    expect(canAct('dismissed')).toBe(false)
  })
})

describe('status map (per-session, in-memory, keyed by toolUseId)', () => {
  it('defaults to pending and round-trips set/get', () => {
    expect(getChipStatus('tu_1')).toBe('pending')
    setChipStatus('tu_1', 'spawned')
    expect(getChipStatus('tu_1')).toBe('spawned')
  })

  it('reset clears all statuses (simulates app restart)', () => {
    setChipStatus('tu_1', 'dismissed')
    resetChipStatuses()
    expect(getChipStatus('tu_1')).toBe('pending')
  })
})
