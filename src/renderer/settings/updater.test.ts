import { describe, it, expect, vi, afterEach } from 'vitest'
import { friendlyError, updaterErrorText, createStuckGuard, STUCK_CHECK_TIMEOUT_MS } from './updater'

describe('friendlyError (raw → actionable Thai)', () => {
  it('maps offline / DNS / timeout / net errors to an offline message', () => {
    for (const raw of ['getaddrinfo ENOTFOUND api.github.com', 'ETIMEDOUT', 'EAI_AGAIN', 'net::ERR_INTERNET_DISCONNECTED']) {
      expect(friendlyError(raw)).toBe('ออฟไลน์หรือเชื่อมต่อ GitHub ไม่ได้')
    }
  })
  it('maps GitHub rate limiting (HTTP 403 / rate limit) to a retry-later message', () => {
    expect(friendlyError('HTTP 403')).toBe('GitHub จำกัดจำนวนครั้ง — ลองใหม่ภายหลัง')
    expect(friendlyError('API rate limit exceeded')).toBe('GitHub จำกัดจำนวนครั้ง — ลองใหม่ภายหลัง')
  })
  it('maps HTTP 404 (no releases) to a no-release message', () => {
    expect(friendlyError('HTTP 404')).toBe('ยังไม่มีเวอร์ชันเผยแพร่')
  })
  it('passes through anything it does not recognize', () => {
    expect(friendlyError('some weird error')).toBe('some weird error')
    expect(friendlyError('')).toBe('')
  })
})

describe('updaterErrorText (op-aware wording)', () => {
  it('check errors read as a check failure with the friendly detail', () => {
    expect(updaterErrorText('check', 'HTTP 403')).toBe('เช็กอัปเดตไม่สำเร็จ — GitHub จำกัดจำนวนครั้ง — ลองใหม่ภายหลัง')
    expect(updaterErrorText('check', 'ETIMEDOUT')).toBe('เช็กอัปเดตไม่สำเร็จ — ออฟไลน์หรือเชื่อมต่อ GitHub ไม่ได้')
  })
  it('download errors use fixed wording, never the raw detail', () => {
    const text = updaterErrorText('download', 'ETIMEDOUT during download')
    expect(text).toBe('ดาวน์โหลดอัปเดตไม่สำเร็จ — ลองใหม่อีกครั้ง')
    expect(text).not.toContain('ETIMEDOUT')
    expect(text).not.toContain('เช็ก')
  })
})

describe('createStuckGuard (fake-timer stuck-check guard)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('exports a ~30s default timeout', () => {
    expect(STUCK_CHECK_TIMEOUT_MS).toBe(30_000)
  })

  it('fires onStuck after the timeout when never disarmed', () => {
    vi.useFakeTimers()
    const onStuck = vi.fn()
    const guard = createStuckGuard(onStuck)
    guard.arm()
    expect(onStuck).not.toHaveBeenCalled()
    vi.advanceTimersByTime(STUCK_CHECK_TIMEOUT_MS)
    expect(onStuck).toHaveBeenCalledTimes(1)
  })

  it('does not fire when disarmed before the timeout (event flipped the phase)', () => {
    vi.useFakeTimers()
    const onStuck = vi.fn()
    const guard = createStuckGuard(onStuck)
    guard.arm()
    vi.advanceTimersByTime(STUCK_CHECK_TIMEOUT_MS - 1)
    guard.disarm()
    vi.advanceTimersByTime(1000)
    expect(onStuck).not.toHaveBeenCalled()
  })

  it('re-arming resets the timer (does not fire early)', () => {
    vi.useFakeTimers()
    const onStuck = vi.fn()
    const guard = createStuckGuard(onStuck)
    guard.arm()
    vi.advanceTimersByTime(STUCK_CHECK_TIMEOUT_MS - 1)
    guard.arm() // re-arm resets the countdown
    vi.advanceTimersByTime(2) // past the *first* deadline
    expect(onStuck).not.toHaveBeenCalled()
    vi.advanceTimersByTime(STUCK_CHECK_TIMEOUT_MS)
    expect(onStuck).toHaveBeenCalledTimes(1)
  })

  it('honors a custom timeout', () => {
    vi.useFakeTimers()
    const onStuck = vi.fn()
    const guard = createStuckGuard(onStuck, 5000)
    guard.arm()
    vi.advanceTimersByTime(4999)
    expect(onStuck).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onStuck).toHaveBeenCalledTimes(1)
  })
})
