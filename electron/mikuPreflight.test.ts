import { describe, it, expect } from 'vitest'
import { decide, type Probe } from './mikuPreflight'

/** A machine that passes every check: lots of disk/ram, NVIDIA, online, x64. */
function healthy(): Probe {
  return { freeDiskGB: 50, totalRamGB: 32, hasNvidia: true, online: true, arch: 'x64' }
}

function check(r: ReturnType<typeof decide>, id: string) {
  return r.checks.find((c) => c.id === id)
}

describe('decide (pure preflight verdict — no real disk/GPU access)', () => {
  it('a healthy machine passes everything (ok, level pass)', () => {
    const r = decide(healthy())
    expect(r.ok).toBe(true)
    expect(r.level).toBe('pass')
    expect(r.checks).toHaveLength(5)
    expect(r.checks.every((c) => c.level === 'pass')).toBe(true)
  })

  it('disk < 3GB → fail (blocks; downloads need the space)', () => {
    const r = decide({ ...healthy(), freeDiskGB: 2 })
    expect(check(r, 'disk')?.level).toBe('fail')
    expect(r.ok).toBe(false)
    expect(r.level).toBe('fail')
  })

  it('disk exactly 3GB → pass (boundary is < 3)', () => {
    expect(check(decide({ ...healthy(), freeDiskGB: 3 }), 'disk')?.level).toBe('pass')
  })

  it('ram < 4GB → fail', () => {
    const r = decide({ ...healthy(), totalRamGB: 3 })
    expect(check(r, 'ram')?.level).toBe('fail')
    expect(r.ok).toBe(false)
  })

  it('ram 6GB → warn but still ok (no fail)', () => {
    const r = decide({ ...healthy(), totalRamGB: 6 })
    expect(check(r, 'ram')?.level).toBe('warn')
    expect(r.ok).toBe(true)
    expect(r.level).toBe('warn')
  })

  it('ram exactly 8GB → pass (boundary is < 8)', () => {
    expect(check(decide({ ...healthy(), totalRamGB: 8 }), 'ram')?.level).toBe('pass')
  })

  it('no NVIDIA GPU → warn but ok (CPU mode, slower)', () => {
    const r = decide({ ...healthy(), hasNvidia: false })
    expect(check(r, 'gpu')?.level).toBe('warn')
    expect(check(r, 'gpu')?.detail.toLowerCase()).toContain('cpu')
    expect(r.ok).toBe(true)
    expect(r.level).toBe('warn')
  })

  it('offline → fail (cannot download python/torch/model)', () => {
    const r = decide({ ...healthy(), online: false })
    expect(check(r, 'net')?.level).toBe('fail')
    expect(r.ok).toBe(false)
  })

  it('non-x64 arch (arm64) → fail (no standalone wheels bundled)', () => {
    const r = decide({ ...healthy(), arch: 'arm64' })
    expect(check(r, 'arch')?.level).toBe('fail')
    expect(r.ok).toBe(false)
  })

  it('overall level is the worst single check', () => {
    // GPU warn + disk fail → worst is fail.
    const r = decide({ ...healthy(), hasNvidia: false, freeDiskGB: 1 })
    expect(r.level).toBe('fail')
  })

  it('always returns one Check per probe field, stable ids', () => {
    const ids = decide(healthy()).checks.map((c) => c.id).sort()
    expect(ids).toEqual(['arch', 'disk', 'gpu', 'net', 'ram'])
  })
})
