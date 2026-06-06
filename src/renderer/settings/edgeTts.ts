/**
 * Free Edge-TTS (Microsoft online neural voices) — no API key, unlimited, many
 * languages incl. Thai. Synthesis runs in the Electron main process (see
 * preload `edgeTts`); here we just play the returned MP3.
 */

export interface EdgeVoice {
  id: string
  name: string
  vibe: string
}

/** A small curated set (Thai + a few expressive English/Japanese). */
export const EDGE_VOICES: EdgeVoice[] = [
  { id: 'th-TH-PremwadeeNeural', name: 'เปรมวดี', vibe: 'ไทย หญิง' },
  { id: 'th-TH-NiwatNeural', name: 'นิวัฒน์', vibe: 'ไทย ชาย' },
  { id: 'en-US-AnaNeural', name: 'Ana', vibe: 'อังกฤษ เด็ก สดใส (อนิเมะ)' },
  { id: 'en-US-JennyNeural', name: 'Jenny', vibe: 'อังกฤษ หญิง' },
  { id: 'en-US-GuyNeural', name: 'Guy', vibe: 'อังกฤษ ชาย' },
  { id: 'ja-JP-NanamiNeural', name: 'Nanami', vibe: 'ญี่ปุ่น หญิง' },
]

/** Convert multiplier (1.0 = normal) to Edge SSML strings. */
export function edgeRate(rate = 1): string {
  const pct = Math.round((rate - 1) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}
export function edgePitch(pitch = 1): string {
  const hz = Math.round((pitch - 1) * 50)
  return `${hz >= 0 ? '+' : ''}${hz}Hz`
}

function isAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.claudedeck?.edgeTts
}

let current: HTMLAudioElement | null = null

export function stopEdge(): void {
  if (current) {
    current.pause()
    current.src = ''
    current = null
  }
}

interface EdgeOpts {
  voice: string
  rate?: number
  pitch?: number
}

/** Synthesize via Edge-TTS and play. Rejects on failure (so callers can fall back). */
export async function edgeSpeak(text: string, opts: EdgeOpts): Promise<void> {
  if (!text.trim()) return
  if (!isAvailable()) throw new Error('edge-tts bridge unavailable')
  const b64 = await window.claudedeck.edgeTts({
    text,
    voice: opts.voice,
    rate: edgeRate(opts.rate),
    pitch: edgePitch(opts.pitch),
  })
  if (!b64) throw new Error('empty audio')
  stopEdge()
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(`data:audio/mp3;base64,${b64}`)
    current = audio
    audio.onended = () => {
      if (current === audio) current = null
      resolve()
    }
    audio.onerror = () => reject(new Error('audio playback failed'))
    audio.play().catch(reject)
  })
}
