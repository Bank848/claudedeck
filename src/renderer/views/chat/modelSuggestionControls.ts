/**
 * Pure, unit-testable logic for the ModelSuggestion confirm dialog. Keeping the
 * keyboard/voice/focus-trap decisions out of the .tsx lets us test them like
 * voiceCommands.ts (the repo has no jsdom; component rendering is verified in preview).
 */
import type { Tier } from '@/settings/modelRouting'

/** Enter → confirm the suggestion; Esc → fall back to the resting model; else no-op. */
export function keyToChoice(key: string, suggested: Tier, resting: Tier): Tier | null {
  if (key === 'Enter') return suggested
  if (key === 'Escape') return resting
  return null
}

/** Tab focus trap over N buttons. Forward wraps to 0, Shift+Tab wraps to N-1. */
export function trapTabIndex(current: number, count: number, shiftKey: boolean): number {
  if (count <= 0) return 0
  const step = shiftKey ? -1 : 1
  return (current + step + count) % count
}

/**
 * Map a spoken transcript to a dialog choice while the dialog is open. Returns a Tier
 * to choose, or null if nothing matched. "confirm/ใช้ตามแนะนำ" → the suggested tier;
 * "cancel/resting/ยกเลิก" → the resting tier; a model name → that tier.
 */
export function voiceToChoice(raw: string, suggested: Tier, resting: Tier): Tier | null {
  const t = raw.toLowerCase()
  const has = (...words: string[]): boolean => words.some((w) => t.includes(w))

  if (has('confirm', 'ใช้ตามแนะนำ', 'ตกลง', 'ยืนยัน', 'ตามนั้น')) return suggested
  if (has('cancel', 'resting', 'ยกเลิก', 'ใช้ตัวเดิม', 'เหมือนเดิม')) return resting
  // Explicit model names override.
  if (has('fable', 'เฟเบิล')) return 'fable'
  if (has('opus', 'โอปุส')) return 'opus'
  if (has('sonnet', 'ซอนเน็ต', 'ซันเน็ต')) return 'sonnet'
  if (has('haiku', 'ไฮกุ')) return 'haiku'
  return null
}
