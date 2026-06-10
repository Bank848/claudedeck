/**
 * Per-turn model routing — pure, unit-testable decision logic.
 *
 * A fast heuristic suggests a model tier from the prompt; a separate (main-process)
 * Haiku classifier is consulted ONLY when the heuristic is borderline. `decideRouting`
 * then turns a suggestion into a concrete action (spawn silently, or show the confirm
 * dialog) per the user's routing-mode setting.
 *
 * This module holds NO React/IPC/Electron deps so it tests like `hydrationDecision.ts`.
 */

export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type RoutingMode = 'off' | 'suggest' | 'auto'

export const TIER_ORDER: Record<Tier, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3 }
const ORDERED: Tier[] = ['haiku', 'sonnet', 'opus', 'fable']

/** Internal Tier → ClaudeDeck picker id (the value handed to claude.start({model})). */
export const TIER_TO_MODEL_ID: Record<Tier, string> = {
  haiku: 'haiku-4-5',
  sonnet: 'sonnet-4-6',
  opus: 'opus-4-8',
  fable: 'fable-5',
}

/** Picker id → Tier. Unknown / custom-* / undefined fall back to the safe middle (opus). */
export function modelIdToTier(id: string | undefined): Tier {
  switch (id) {
    case 'haiku-4-5':
      return 'haiku'
    case 'sonnet-4-6':
      return 'sonnet'
    case 'fable-5':
      return 'fable'
    default:
      return 'opus'
  }
}

const up = (t: Tier): Tier => ORDERED[Math.min(TIER_ORDER[t] + 1, TIER_ORDER.fable)]
const down = (t: Tier): Tier => ORDERED[Math.max(TIER_ORDER[t] - 1, TIER_ORDER.haiku)]

/* ── Heuristic signals (EN + TH; the primary user writes Thai) ─────────────────── */

// Strong "hard" markers → architecture / deep-reasoning class → push to fable.
const HARD_FABLE = [
  'architecture',
  'concurrency',
  'race condition',
  'deadlock',
  'distributed',
  'prove ',
  'สถาปัตยกรรม',
  'ออกแบบระบบ',
  'ออกแบบสถาปัตยกรรม',
]
// Mild "hard" markers → bump one tier up from resting.
const HARD_UP = [
  'refactor',
  'migrate',
  'debug',
  'root cause',
  'optimize the algorithm',
  'design the',
  'รีแฟกเตอร์',
  'ดีบัก',
  'แก้บั๊ก',
  'หาเหตุ',
  'ย้ายระบบ',
]
// "Easy" markers → mechanical / low-judgment → push to haiku.
const EASY = [
  'rename',
  'format ',
  'list ',
  'read ',
  'where is',
  'typo',
  'add a comment',
  'เปลี่ยนชื่อ',
  'จัดรูปแบบ',
  'อ่านไฟล์',
  'ลิสต์',
  'อยู่ไหน',
  'พิมพ์ผิด',
]

const SHORT_CHARS = 40
const LONG_CHARS = 600
const MIN_CLASSIFIER_CHARS = 80

const hits = (text: string, words: string[]): boolean => words.some((w) => text.includes(w))

/** Pure: does the prompt look like a pasted error / stack trace? */
export function detectErrorTrace(prompt: string): boolean {
  const markers: RegExp[] = [
    /traceback \(most recent call last\)/i,
    /^\s*at\s+.+:\d+:\d+/m, // JS stack frame: "at fn (file:line:col)"
    /^\s*file ".+", line \d+/im, // Python frame
    /\b\w*(error|exception):/i, // "TypeError:", "RuntimeException:"
  ]
  return markers.some((re) => re.test(prompt))
}

export interface RoutingContext {
  prompt: string
  /** Pasted stack trace / error log (see detectErrorTrace). */
  hasErrorTrace?: boolean
  restingTier: Tier
}

export interface Suggestion {
  tier: Tier
  confidence: 'low' | 'medium' | 'high'
  /** Shown to the user + announced via aria-live (caller localizes if desired). */
  reason: string
  /** True when borderline → caller may fire the Haiku classifier. */
  needsClassifier: boolean
}

/** Fast, deterministic heuristic. Never throws; always returns a Suggestion. */
export function suggestModelHeuristic(ctx: RoutingContext): Suggestion {
  const text = ctx.prompt.toLowerCase()
  const len = ctx.prompt.trim().length
  const resting = ctx.restingTier

  const fableHit = hits(text, HARD_FABLE)
  const upHit = hits(text, HARD_UP)
  const easyHit = hits(text, EASY)
  const trace = !!ctx.hasErrorTrace

  const hardSignal = fableHit || upHit || trace || len > LONG_CHARS
  const easySignal = easyHit

  // Conflicting signals — don't guess; let the classifier arbitrate.
  if (hardSignal && easySignal) {
    return { tier: resting, confidence: 'low', reason: 'conflicting easy + hard signals', needsClassifier: true }
  }

  // Strong hard → fable.
  if (fableHit || (trace && upHit)) {
    return { tier: 'fable', confidence: 'high', reason: 'architecture / deep-reasoning signal', needsClassifier: false }
  }

  // Mild hard → one tier up from resting.
  if (upHit || trace || len > LONG_CHARS) {
    return { tier: up(resting), confidence: 'medium', reason: 'complex / debugging signal', needsClassifier: false }
  }

  // Strong easy → haiku.
  if (easyHit) {
    return { tier: 'haiku', confidence: 'high', reason: 'mechanical / low-judgment task', needsClassifier: false }
  }

  // No keyword signal.
  if (len >= MIN_CLASSIFIER_CHARS) {
    // Long but unmatched (e.g. Thai prose the keyword sets miss) → ask the classifier.
    return { tier: resting, confidence: 'low', reason: 'no clear signal on a substantial prompt', needsClassifier: true }
  }
  // Short and unmatched — not worth a paid classifier call.
  return { tier: resting, confidence: 'medium', reason: 'routine', needsClassifier: false }
}

export interface RoutingDecision {
  /** Picker id to spawn with (TIER_TO_MODEL_ID[tier]). */
  modelId: string
  tier: Tier
  /** confirm → show the ModelSuggestion dialog; silent → spawn directly. */
  action: 'silent' | 'confirm'
  /** Carried so the dialog can render the reason. */
  suggestion: Suggestion
}

const decision = (tier: Tier, action: 'silent' | 'confirm', suggestion: Suggestion): RoutingDecision => ({
  modelId: TIER_TO_MODEL_ID[tier],
  tier,
  action,
  suggestion,
})

/**
 * Pure. Combine a suggestion with the routing mode + resting model into the final
 * action. Never throws. Safety invariant: in `auto` mode an upgrade *to fable* still
 * requires confirmation — auto never silently spends the most expensive model.
 */
export function decideRouting(
  s: Suggestion,
  restingTier: Tier,
  mode: RoutingMode,
  alwaysConfirm: boolean,
): RoutingDecision {
  if (mode === 'off') return decision(restingTier, 'silent', s)

  const isUpgrade = TIER_ORDER[s.tier] > TIER_ORDER[restingTier]
  const differs = s.tier !== restingTier

  if (mode === 'auto') {
    if (alwaysConfirm) return decision(s.tier, 'confirm', s)
    // Auto NEVER auto-escalates to fable — that one upgrade always confirms.
    if (s.tier === 'fable' && isUpgrade) return decision(s.tier, 'confirm', s)
    return decision(s.tier, 'silent', s)
  }

  // mode === 'suggest'
  if (alwaysConfirm) return decision(s.tier, 'confirm', s)
  if (isUpgrade) return decision(s.tier, 'confirm', s)
  if (differs && s.confidence === 'high') return decision(s.tier, 'confirm', s)
  // Same-or-cheaper at non-high confidence → stay on resting silently.
  return decision(restingTier, 'silent', s)
}
