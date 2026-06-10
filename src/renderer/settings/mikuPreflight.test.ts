import { describe, it, expect } from 'vitest'
import { summarize, failReason, progressLabel } from './mikuPreflight'
import type { Verdict } from '../../../electron/mikuPreflight'

const pass: Verdict = {
  ok: true,
  level: 'pass',
  checks: [{ id: 'gpu', level: 'pass', detail: 'NVIDIA' }],
}
const warn: Verdict = {
  ok: true,
  level: 'warn',
  checks: [{ id: 'gpu', level: 'warn', detail: 'CPU mode' }],
}
const fail: Verdict = {
  ok: false,
  level: 'fail',
  checks: [
    { id: 'gpu', level: 'warn', detail: 'CPU mode' },
    { id: 'disk', level: 'fail', detail: 'พื้นที่ว่าง 1.0GB — ต้องอย่างน้อย 3GB' },
  ],
}

describe('failReason (first failing check)', () => {
  it('null when no verdict yet', () => {
    expect(failReason(null)).toBeNull()
  })
  it('null when nothing failed', () => {
    expect(failReason(pass)).toBeNull()
    expect(failReason(warn)).toBeNull()
  })
  it('returns the first fail detail (skips warns)', () => {
    expect(failReason(fail)).toContain('พื้นที่ว่าง')
  })
})

describe('summarize (one-line aria status)', () => {
  it('not-yet-checked has a neutral message', () => {
    expect(summarize(null)).toBeTruthy()
  })
  it('pass reads as ready', () => {
    expect(summarize(pass)).toContain('พร้อม')
  })
  it('warn mentions a caution but is not a block', () => {
    const s = summarize(warn)
    expect(s).not.toContain('ไม่ได้')
    expect(s.toLowerCase()).toContain('cpu')
  })
  it('fail surfaces the blocking reason', () => {
    expect(summarize(fail)).toContain('พื้นที่ว่าง')
  })
})

describe('progressLabel', () => {
  it('empty when no progress', () => {
    expect(progressLabel(null)).toBe('')
  })
  it('prefers the human message', () => {
    expect(progressLabel({ step: 'python', percent: 40, message: 'กำลังดาวน์โหลด Python… 40%' })).toContain(
      'ดาวน์โหลด',
    )
  })
  it('falls back to step + percent when message is empty', () => {
    expect(progressLabel({ step: 'deps', percent: 10, message: '' })).toContain('deps')
  })
})
