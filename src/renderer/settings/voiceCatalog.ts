/**
 * Unified voice catalog — one flat list of named voice choices that hides the
 * underlying TTS "engine" concept from the user. Each choice knows which engine
 * it runs on; picking one sets everything (engine + voice + pitch/rate) at once.
 *
 * Grouped for screen-reader clarity: each group renders as its own labeled
 * radiogroup so assistive tech announces "Instant, 1 of 5" etc.
 */
import { VOICE_PRESETS } from './speech'
import { EDGE_VOICES } from './edgeTts'

export type VoiceGroup = 'instant' | 'online' | 'miku'

export interface VoiceChoice {
  /** Stable id stored in settings.voiceChoiceId (source of truth for "which voice"). */
  id: string
  /** Display name (also doubles as the wake word). */
  name: string
  /** Short one-line description. */
  vibe: string
  group: VoiceGroup
  engine: 'system' | 'edge' | 'custom'
  // system-persona fields
  gender?: 'male' | 'female'
  pitch?: number
  rate?: number
  // edge field
  edgeVoice?: string
}

export interface VoiceGroupMeta {
  id: VoiceGroup
  label: string
  hint: string
}

export const VOICE_GROUPS: VoiceGroupMeta[] = [
  { id: 'instant', label: 'ทันที (ออฟไลน์)', hint: 'เสียงในเครื่อง เปิดมาก็ใช้ได้ ไม่ต้องต่อเน็ต' },
  { id: 'online', label: 'ธรรมชาติ (ออนไลน์ ฟรี)', hint: 'เสียง neural ฟรี ฟังเป็นธรรมชาติ ต้องต่อเน็ต' },
  { id: 'miku', label: 'มิกุแท้ (RVC)', hint: 'เสียงมิกุจริงจากเซิร์ฟเวอร์ในเครื่อง ใช้ทรัพยากรเยอะ' },
]

/** The single fixed Miku-RVC choice (custom local server). */
export const MIKU_CHOICE_ID = 'miku:rvc'

/** Build the full catalog from the persona + edge sources. */
export function buildVoiceCatalog(): VoiceChoice[] {
  // Exclude the pitch-shifted "มิกุ" persona — it is a system voice in disguise and
  // confuses users vs the real Miku-RVC choice below.
  const instant: VoiceChoice[] = VOICE_PRESETS.filter((p) => p.id !== 'miku').map((p) => ({
    id: `sys:${p.id}`,
    name: p.name,
    vibe: p.style,
    group: 'instant',
    engine: 'system',
    gender: p.gender,
    pitch: p.pitch,
    rate: p.rate,
  }))
  const online: VoiceChoice[] = EDGE_VOICES.map((v) => ({
    id: `edge:${v.id}`,
    name: v.name,
    vibe: v.vibe,
    group: 'online',
    engine: 'edge',
    edgeVoice: v.id,
  }))
  const miku: VoiceChoice[] = [
    {
      id: MIKU_CHOICE_ID,
      name: 'มิกุ (RVC จริง)',
      vibe: 'เสียงมิกุแท้ในเครื่อง',
      group: 'miku',
      engine: 'custom',
    },
  ]
  return [...instant, ...online, ...miku]
}

/** Look up a choice by id (for resolving the active selection). */
export function findVoiceChoice(id: string): VoiceChoice | undefined {
  return buildVoiceCatalog().find((c) => c.id === id)
}
