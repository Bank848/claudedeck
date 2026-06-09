import type { Effort } from '@/cli/types'

export interface EffortOption {
  /** undefined = let the CLI decide (no --effort flag is sent). */
  effort?: Effort
  /** Picker label. */
  label: string
  /** Number-key shortcut shown in the popover (1..6). */
  shortcut: number
  /** TH + EN voice phrases (lowercase). */
  phrases: string[]
}

export const EFFORT_OPTIONS: EffortOption[] = [
  { effort: undefined, label: 'Auto', shortcut: 1, phrases: ['auto effort', 'default effort', 'อัตโนมัติ', 'ค่าเริ่มต้น'] },
  { effort: 'low', label: 'Low', shortcut: 2, phrases: ['low effort', 'effort low', 'เอฟฟอร์ตต่ำ', 'ระดับต่ำ'] },
  { effort: 'medium', label: 'Medium', shortcut: 3, phrases: ['medium effort', 'effort medium', 'เอฟฟอร์ตกลาง', 'ระดับกลาง'] },
  { effort: 'high', label: 'High', shortcut: 4, phrases: ['high effort', 'effort high', 'เอฟฟอร์ตสูง', 'ระดับสูง'] },
  { effort: 'xhigh', label: 'Extra high', shortcut: 5, phrases: ['extra high effort', 'effort xhigh', 'เอฟฟอร์ตสูงมาก', 'สูงพิเศษ'] },
  { effort: 'max', label: 'Max', shortcut: 6, phrases: ['max effort', 'effort max', 'เอฟฟอร์ตสูงสุด', 'ระดับสูงสุด'] },
]

export function effortLabel(effort?: Effort): string {
  return EFFORT_OPTIONS.find((o) => o.effort === effort)?.label ?? 'Auto'
}

/**
 * Longest matching voice phrase wins (mirrors {@link modeFromVoice}). Returns the
 * whole matched option so the caller reads `.effort` — which is `undefined` for the
 * Auto option. `null` is the single "no phrase matched" state, replacing the old
 * `{ effort: undefined }` that collided with a real Auto match.
 */
export function effortFromVoice(text: string): EffortOption | null {
  const t = text.toLowerCase()
  let best: EffortOption | null = null
  let len = 0
  for (const o of EFFORT_OPTIONS) {
    for (const p of o.phrases) {
      if (t.includes(p) && p.length > len) {
        best = o
        len = p.length
      }
    }
  }
  return best
}
