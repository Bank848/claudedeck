export type EffortLevel = 'faster' | 'medium' | 'smarter'

export interface EffortOption {
  level: EffortLevel
  label: string
  /** Slider stop index (0 = Faster … 2 = Smarter). */
  stop: number
  /** TH + EN voice phrases (lowercase). */
  phrases: string[]
}

export const EFFORT_OPTIONS: EffortOption[] = [
  { level: 'faster', label: 'Faster', stop: 0, phrases: ['effort faster', 'faster', 'เอฟฟอร์ตเร็ว', 'เร็ว'] },
  { level: 'medium', label: 'Medium', stop: 1, phrases: ['effort medium', 'medium effort', 'เอฟฟอร์ตกลาง', 'ปานกลาง'] },
  { level: 'smarter', label: 'Smarter', stop: 2, phrases: ['effort smarter', 'smarter', 'เอฟฟอร์ตฉลาด', 'ฉลาด'] },
]

export const DEFAULT_EFFORT: EffortLevel = 'medium'

export function effortLabel(level: EffortLevel): string {
  return EFFORT_OPTIONS.find((e) => e.level === level)?.label ?? level
}
export function effortToStop(level: EffortLevel): number {
  return EFFORT_OPTIONS.find((e) => e.level === level)?.stop ?? 1
}
export function effortFromStop(stop: number): EffortLevel {
  return EFFORT_OPTIONS.find((e) => e.stop === stop)?.level ?? DEFAULT_EFFORT
}
export function effortFromVoice(text: string): EffortLevel | null {
  const t = text.toLowerCase()
  let best: EffortLevel | null = null
  let len = 0
  for (const o of EFFORT_OPTIONS) {
    for (const p of o.phrases) {
      if (t.includes(p) && p.length > len) {
        best = o.level
        len = p.length
      }
    }
  }
  return best
}
