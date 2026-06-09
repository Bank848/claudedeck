/**
 * Single source of truth for the FINITE set of fixed voice-assistant phrases a
 * blind user hears (view names, status lines, the voice-control greeting, and
 * the permission-mode / reasoning-effort confirmations).
 *
 * Both `App` (which speaks them live) and the Miku prewarm trigger import from
 * here, so the cache-warmed text can never drift from the text actually spoken.
 * Dynamic phrases ("กำลังใช้ <tool>" — the tool name varies) are intentionally
 * NOT included: they can't be enumerated, so they can't be prewarmed.
 *
 * Why both languages: the Miku server picks a DIFFERENT RVC voice config per
 * detected language (th vs en), so each language is a distinct cache key. We warm
 * both so the first utterance is instant whichever language is active.
 */
import { type ActivityId } from '@/mock/fixtures'
import { MODE_OPTIONS } from './permissionModes'
import { EFFORT_OPTIONS } from './effortLevels'

interface LangPair {
  th: string
  en: string
}

/** Activity/view names — also the nav confirmations and screen-reader announcements. */
export const VIEW_NAMES: Record<ActivityId, LangPair> = {
  chat: { th: 'แชท', en: 'Chat' },
  sessions: { th: 'เซสชัน', en: 'Sessions' },
  tasks: { th: 'บอร์ดงาน', en: 'Tasks board' },
  changes: { th: 'การเปลี่ยนแปลง', en: 'Changes' },
  skills: { th: 'สกิล', en: 'Skills' },
  usage: { th: 'การใช้งาน', en: 'Usage' },
  guide: { th: 'คู่มือ', en: 'Guide' },
  settings: { th: 'ตั้งค่า', en: 'Settings' },
}

/** Turn-status lines spoken on every send/result — the highest-frequency phrases. */
export const STATUS: Record<'thinking' | 'done' | 'error' | 'busy', LangPair> = {
  thinking: { th: 'กำลังคิด', en: 'Thinking' },
  done: { th: 'เสร็จแล้ว', en: 'Done' },
  error: { th: 'เกิดข้อผิดพลาด', en: 'Error' },
  busy: { th: 'กำลังทำงานอยู่ รอสักครู่', en: 'Still working, please wait' },
}

/** The greeting spoken when the voice assistant turns on. */
export function voiceGreeting(th: boolean): string {
  return th
    ? 'เปิดผู้ช่วยเสียงแล้ว พูดคำสั่งได้เลย หรือพูดว่า ช่วยเหลือ'
    : 'Voice control on. Say a command, or say help.'
}

/**
 * Collect the full prewarm phrase list (both languages, deduped, no empties).
 * `extraConfirms` are the per-command `confirm` strings from the live `commands[]`
 * array — passed in so they stay zero-drift with what's actually spoken (they are
 * built for the current language only; the cross-language sets above cover both).
 */
export function collectPrewarmPhrases(opts: { extraConfirms?: readonly string[] } = {}): string[] {
  const out: string[] = []
  for (const v of Object.values(VIEW_NAMES)) out.push(v.th, v.en)
  for (const s of Object.values(STATUS)) out.push(s.th, s.en)
  out.push(voiceGreeting(true), voiceGreeting(false))
  for (const o of MODE_OPTIONS) out.push(`โหมด ${o.label}`, o.label)
  for (const o of EFFORT_OPTIONS) out.push(`เอฟฟอร์ต ${o.label}`, `Effort ${o.label}`)
  if (opts.extraConfirms) out.push(...opts.extraConfirms)
  return Array.from(new Set(out.map((s) => s.trim()).filter(Boolean)))
}
