import { describe, it, expect } from 'vitest'
import { startActiveTurn, endActiveTurn, activeTurnFor, type ActiveTurns } from './activeTurns'

describe('activeTurns (#2 — per-session live turn tracking for Stop/cancel)', () => {
  it('records the live turn for a session and reads it back', () => {
    const m = startActiveTurn({}, 's1', 'turn-1')
    expect(activeTurnFor(m, 's1')).toBe('turn-1')
  })

  it('returns undefined for a session with no live turn', () => {
    expect(activeTurnFor({}, 's1')).toBeUndefined()
  })

  it('does not mutate the input map (immutability)', () => {
    const before: ActiveTurns = {}
    startActiveTurn(before, 's1', 'turn-1')
    expect(before).toEqual({})
  })

  it('a newer turn for the same session replaces the old id', () => {
    let m = startActiveTurn({}, 's1', 'turn-1')
    m = startActiveTurn(m, 's1', 'turn-2')
    expect(activeTurnFor(m, 's1')).toBe('turn-2')
  })

  it('endActiveTurn clears the session when the id matches', () => {
    const m = startActiveTurn({}, 's1', 'turn-1')
    expect(activeTurnFor(endActiveTurn(m, 's1', 'turn-1'), 's1')).toBeUndefined()
  })

  it('endActiveTurn for a STALE id leaves a newer turn intact (no clobber)', () => {
    // turn-1 finishes late, AFTER turn-2 already started for the same session.
    let m = startActiveTurn({}, 's1', 'turn-1')
    m = startActiveTurn(m, 's1', 'turn-2')
    m = endActiveTurn(m, 's1', 'turn-1') // stale done — must NOT remove turn-2
    expect(activeTurnFor(m, 's1')).toBe('turn-2')
  })

  it('tracks multiple sessions independently', () => {
    let m = startActiveTurn({}, 's1', 'turn-1')
    m = startActiveTurn(m, 's2', 'turn-9')
    expect(activeTurnFor(m, 's1')).toBe('turn-1')
    expect(activeTurnFor(m, 's2')).toBe('turn-9')
  })
})
