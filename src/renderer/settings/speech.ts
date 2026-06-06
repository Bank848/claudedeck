/**
 * Text-to-speech helpers built on the Web Speech API (works in Electron/Chromium).
 * Used by the read-aloud accessibility feature.
 */
import { useEffect, useState } from 'react'

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Strip markdown / code noise so the spoken output sounds natural. */
export function plainSpeakableText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type VoiceLangPref = 'auto' | 'th-TH' | 'en-US'

/** Resolve the user's language preference to a concrete BCP-47 code + short tag. */
export function resolveLang(pref: VoiceLangPref): { code: 'th-TH' | 'en-US'; short: 'th' | 'en' } {
  if (pref === 'th-TH') return { code: 'th-TH', short: 'th' }
  if (pref === 'en-US') return { code: 'en-US', short: 'en' }
  const isThai = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('th')
  return isThai ? { code: 'th-TH', short: 'th' } : { code: 'en-US', short: 'en' }
}

interface SpeakOptions {
  rate?: number
  /** Pitch 0.5–2.0; higher = more "anime". */
  pitch?: number
  voiceURI?: string
  /** BCP-47 language; helps the engine pick a matching voice when no voiceURI is set. */
  lang?: string
  onEnd?: () => void
  onStart?: () => void
}

export function speak(text: string, opts: SpeakOptions = {}): void {
  if (!isSpeechSupported() || !text) return
  const synth = window.speechSynthesis
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.rate = opts.rate ?? 1
  utter.pitch = opts.pitch ?? 1
  if (opts.lang) utter.lang = opts.lang
  if (opts.voiceURI) {
    const voice = synth.getVoices().find((v) => v.voiceURI === opts.voiceURI)
    if (voice) utter.voice = voice
  } else if (opts.lang) {
    // No explicit voice: prefer one matching the requested language.
    const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(opts.lang!.slice(0, 2)))
    if (voice) utter.voice = voice
  }
  if (opts.onEnd) utter.onend = opts.onEnd
  if (opts.onStart) utter.onstart = opts.onStart
  synth.speak(utter)
}

export function cancelSpeech(): void {
  if (isSpeechSupported()) window.speechSynthesis.cancel()
}

const MALE_HINTS = ['male', 'man', 'david', 'mark', 'guy', 'george', 'liam', 'pattara', 'niwat', 'william', 'daniel', 'fred', 'alex', 'ravi']
const FEMALE_HINTS = ['female', 'woman', 'zira', 'aria', 'jenny', 'emma', 'hazel', 'susan', 'samantha', 'victoria', 'kanya', 'premwadee', 'narisa', 'achara']

/** Best-effort pick of a male/female voice for a language. Returns a voiceURI ('' if none). */
export function findGenderVoice(
  voices: SpeechSynthesisVoice[],
  langShort: string,
  gender: 'male' | 'female',
): string {
  const langVoices = voices.filter((v) => v.lang?.toLowerCase().startsWith(langShort))
  const pool = langVoices.length ? langVoices : voices
  const hints = gender === 'male' ? MALE_HINTS : FEMALE_HINTS
  const hit = pool.find((v) => hints.some((h) => v.name.toLowerCase().includes(h)))
  return (hit ?? pool[0])?.voiceURI ?? ''
}

export interface VoicePreset {
  id: string
  /** Persona name shown on the button. */
  name: string
  /** Short style description. */
  style: string
  gender: 'male' | 'female'
  pitch: number
  rate: number
}

/** Named voice "personas": normal + anime styles, realised via pitch/rate over a system voice. */
export const VOICE_PRESETS: VoicePreset[] = [
  { id: 'male-normal', name: 'บีม', style: 'ชายปกติ', gender: 'male', pitch: 0.95, rate: 1.0 },
  { id: 'female-normal', name: 'ครีม', style: 'หญิงปกติ', gender: 'female', pitch: 1.1, rate: 1.0 },
  { id: 'male-anime', name: 'ไคโตะ', style: 'ชายอนิเมะ', gender: 'male', pitch: 1.5, rate: 1.12 },
  { id: 'female-anime', name: 'ริน', style: 'หญิงอนิเมะ', gender: 'female', pitch: 1.7, rate: 1.15 },
  { id: 'miku', name: 'มิกุ', style: 'สังเคราะห์สดใส', gender: 'female', pitch: 2.0, rate: 1.28 },
]

/** React hook returning the list of available voices (loads asynchronously). */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    if (!isSpeechSupported()) return
    const load = (): void => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])
  return voices
}
