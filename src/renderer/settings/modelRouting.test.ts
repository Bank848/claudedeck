import { describe, it, expect } from 'vitest'
import {
  TIER_ORDER,
  TIER_TO_MODEL_ID,
  modelIdToTier,
  detectErrorTrace,
  suggestModelHeuristic,
  decideRouting,
  type Tier,
  type RoutingContext,
  type Suggestion,
} from './modelRouting'


describe('tier maps', () => {
  it('orders haiku < sonnet < opus < fable', () => {
    expect(TIER_ORDER.haiku).toBeLessThan(TIER_ORDER.sonnet)
    expect(TIER_ORDER.sonnet).toBeLessThan(TIER_ORDER.opus)
    expect(TIER_ORDER.opus).toBeLessThan(TIER_ORDER.fable)
  })

  it('TIER_TO_MODEL_ID → modelIdToTier round-trips for available tiers', () => {
    const available: Tier[] = ['haiku', 'sonnet', 'opus']
    for (const t of available) expect(modelIdToTier(TIER_TO_MODEL_ID[t])).toBe(t)
  })

  it('fable maps to opus-4-8 (unavailable — graceful fallback)', () => {
    expect(TIER_TO_MODEL_ID.fable).toBe('opus-4-8')
    expect(modelIdToTier('fable-5')).toBe('opus')
    expect(TIER_TO_MODEL_ID.opus).toBe('opus-4-8')
  })

  it('modelIdToTier falls back to opus for unknown / custom / undefined ids', () => {
    expect(modelIdToTier('custom-123')).toBe('opus')
    expect(modelIdToTier(undefined)).toBe('opus')
    expect(modelIdToTier('totally-unknown')).toBe('opus')
  })
})

describe('detectErrorTrace', () => {
  it('detects a JS stack frame', () => {
    expect(
      detectErrorTrace("TypeError: cannot read 'x' of undefined\n    at foo (app.js:10:5)"),
    ).toBe(true)
  })
  it('detects a Python traceback', () => {
    expect(
      detectErrorTrace('Traceback (most recent call last):\n  File "a.py", line 3, in <module>'),
    ).toBe(true)
  })
  it('is false for ordinary prose', () => {
    expect(detectErrorTrace('Add a dark-mode toggle to the settings page and persist it.')).toBe(false)
  })
})

describe('suggestModelHeuristic', () => {
  const ctx = (prompt: string, extra: Partial<RoutingContext> = {}): RoutingContext => ({
    prompt,
    restingTier: 'opus',
    ...extra,
  })

  it('routes a clear architecture/concurrency prompt to opus (high; fable unavailable)', () => {
    const s = suggestModelHeuristic(ctx('Redesign the system architecture for concurrency safety'))
    expect(s.tier).toBe('opus')
    expect(s.confidence).toBe('high')
    expect(s.needsClassifier).toBe(false)
  })

  it('routes a clear mechanical prompt to haiku (high)', () => {
    const s = suggestModelHeuristic(ctx('rename the variable foo to bar'))
    expect(s.tier).toBe('haiku')
    expect(s.confidence).toBe('high')
    expect(s.needsClassifier).toBe(false)
  })

  it('bumps one tier up (not fable) for a mild-hard keyword', () => {
    const s = suggestModelHeuristic(ctx('refactor the auth module', { restingTier: 'sonnet' }))
    expect(s.tier).toBe('opus') // one up from sonnet
    expect(s.confidence).toBe('medium')
  })

  it('a pasted error trace alone bumps up one tier (medium); capped at opus', () => {
    const s = suggestModelHeuristic(ctx('why does this happen', { hasErrorTrace: true }))
    expect(s.tier).toBe('opus') // up() is capped at opus (fable unavailable)
    expect(s.confidence).toBe('medium')
  })

  it('error trace + a hard keyword → opus (high; fable unavailable)', () => {
    const s = suggestModelHeuristic(ctx('debug this', { hasErrorTrace: true }))
    expect(s.tier).toBe('opus')
    expect(s.confidence).toBe('high')
  })

  it('conflicting signals (hard + easy) → low confidence, needs classifier', () => {
    const s = suggestModelHeuristic(ctx('rename the architecture design doc file'))
    expect(s.confidence).toBe('low')
    expect(s.needsClassifier).toBe(true)
    expect(s.tier).toBe('opus') // stays resting until classifier decides
  })

  it('Thai hard-keyword prompt routes up (keyword set is not English-only)', () => {
    const s = suggestModelHeuristic(ctx('ช่วยออกแบบสถาปัตยกรรมของระบบใหม่ให้หน่อย'))
    expect(s.tier).toBe('opus') // fable unavailable — caps at opus
    expect(s.confidence).toBe('high')
  })

  it('long no-signal prompt (e.g. Thai prose) → low confidence → needs classifier', () => {
    const long =
      'ช่วยดูเรื่องนี้ให้หน่อยนะ มันเกี่ยวกับการทำงานของระบบที่ฉันไม่แน่ใจว่าควรเริ่มตรงไหนดี ' +
      'และอยากให้ช่วยคิดวิธีที่เหมาะสมที่สุดสำหรับงานนี้ โดยพิจารณาหลายปัจจัยประกอบกัน'
    expect(long.trim().length).toBeGreaterThanOrEqual(80)
    const s = suggestModelHeuristic(ctx(long))
    expect(s.confidence).toBe('low')
    expect(s.needsClassifier).toBe(true)
  })

  it('short no-signal prompt stays at resting, medium, no classifier (not worth paying)', () => {
    const s = suggestModelHeuristic(ctx('thanks, looks good'))
    expect(s.tier).toBe('opus')
    expect(s.confidence).toBe('medium')
    expect(s.needsClassifier).toBe(false)
  })

  it('never throws on empty input', () => {
    expect(() => suggestModelHeuristic(ctx(''))).not.toThrow()
  })
})

describe('decideRouting', () => {
  const sug = (tier: Tier, confidence: Suggestion['confidence'] = 'medium'): Suggestion => ({
    tier,
    confidence,
    reason: 'r',
    needsClassifier: false,
  })

  it('mode off → always silent at resting, regardless of suggestion', () => {
    const d = decideRouting(sug('fable', 'high'), 'opus', 'off', false)
    expect(d.action).toBe('silent')
    expect(d.tier).toBe('opus')
    expect(d.modelId).toBe('opus-4-8')
  })

  it('suggest mode: an upgrade always confirms (never silently spend more)', () => {
    const d = decideRouting(sug('fable', 'medium'), 'opus', 'suggest', false)
    expect(d.action).toBe('confirm')
    expect(d.tier).toBe('fable')
    expect(d.modelId).toBe('opus-4-8') // fable → opus fallback
  })

  it('suggest mode: low-confidence downgrade stays silent at resting', () => {
    const d = decideRouting(sug('haiku', 'medium'), 'opus', 'suggest', false)
    expect(d.action).toBe('silent')
    expect(d.tier).toBe('opus')
  })

  it('suggest mode: high-confidence differing (downgrade) confirms', () => {
    const d = decideRouting(sug('haiku', 'high'), 'opus', 'suggest', false)
    expect(d.action).toBe('confirm')
    expect(d.tier).toBe('haiku')
  })

  it('suggest mode + alwaysConfirm: confirms even for same tier', () => {
    const d = decideRouting(sug('opus', 'high'), 'opus', 'suggest', true)
    expect(d.action).toBe('confirm')
  })

  it('auto mode: applies a cheaper suggestion silently (savings)', () => {
    const d = decideRouting(sug('sonnet', 'medium'), 'opus', 'auto', false)
    expect(d.action).toBe('silent')
    expect(d.tier).toBe('sonnet')
    expect(d.modelId).toBe('sonnet-5')
  })

  it('auto mode: fable suggestion silently falls back to opus (fable unavailable)', () => {
    const d = decideRouting(sug('fable', 'high'), 'opus', 'auto', false)
    expect(d.action).toBe('silent')
    expect(d.tier).toBe('fable')
    expect(d.modelId).toBe('opus-4-8') // actual model used
  })

  it('auto mode: an upgrade to opus applies silently', () => {
    const d = decideRouting(sug('opus', 'high'), 'sonnet', 'auto', false)
    expect(d.action).toBe('silent')
    expect(d.tier).toBe('opus')
  })
})
