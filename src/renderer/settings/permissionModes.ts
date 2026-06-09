import type { PermissionMode } from '@/cli/types'

export interface ModeOption {
  mode: PermissionMode
  /** Claude-app-style label. */
  label: string
  /** Number-key shortcut shown in the popover (1..6). */
  shortcut: number
  /** TH + EN voice phrases (lowercase). */
  phrases: string[]
}

export const MODE_OPTIONS: ModeOption[] = [
  { mode: 'default', label: 'Ask permissions', shortcut: 1, phrases: ['ask permissions', 'ask mode', 'โหมดถาม', 'ถามก่อน'] },
  { mode: 'acceptEdits', label: 'Accept edits', shortcut: 2, phrases: ['accept edits', 'allow edits', 'ยอมรับการแก้ไข', 'ยอมรับแก้ไข', 'อนุญาตแก้ไข'] },
  { mode: 'plan', label: 'Plan mode', shortcut: 3, phrases: ['plan mode', 'read only', 'โหมดวางแผน', 'อ่านอย่างเดียว'] },
  { mode: 'bypassPermissions', label: 'Bypass permissions', shortcut: 4, phrases: ['bypass permissions', 'bypass', 'โหมดบายพาส', 'บายพาส', 'ข้ามสิทธิ์'] },
  { mode: 'auto', label: 'Auto', shortcut: 5, phrases: ['auto mode', 'automatic', 'โหมดอัตโนมัติ', 'อัตโนมัติ'] },
  { mode: 'dontAsk', label: "Don't ask", shortcut: 6, phrases: ["don't ask", 'dont ask', 'no ask', 'ไม่ต้องถาม', 'ไม่ถาม'] },
]

export function modeLabel(mode: PermissionMode): string {
  return MODE_OPTIONS.find((o) => o.mode === mode)?.label ?? mode
}

/** Longest matching phrase wins (mirrors voiceCommands.dispatchCommand). */
export function modeFromVoice(text: string): PermissionMode | null {
  const t = text.toLowerCase()
  let best: PermissionMode | null = null
  let len = 0
  for (const o of MODE_OPTIONS) {
    for (const p of o.phrases) {
      if (t.includes(p) && p.length > len) {
        best = o.mode
        len = p.length
      }
    }
  }
  return best
}
