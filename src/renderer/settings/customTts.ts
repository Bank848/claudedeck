/**
 * Advanced: a user-run local TTS server (OpenAI-compatible /v1/audio/speech).
 * Lets power users plug in an RVC / VITS "Miku" voice. Resource-heavy & may lag
 * on weak GPUs — surfaced with a warning in Settings. Synthesis goes through the
 * Electron main process (see preload `customTts`) to avoid renderer CORS.
 */

let current: HTMLAudioElement | null = null

export function stopCustom(): void {
  if (current) {
    current.pause()
    current.src = ''
    current = null
  }
}

interface CustomOpts {
  url: string
  voice: string
  model: string
  apiKey?: string
}

function isAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.claudedeck?.customTts
}

/** Synthesize via the custom server and play. Rejects on any failure (callers fall back). */
export async function customSpeak(text: string, opts: CustomOpts): Promise<void> {
  if (!text.trim()) return
  if (!isAvailable()) throw new Error('custom-tts bridge unavailable')
  if (!opts.url) throw new Error('no custom server url')
  const b64 = await window.claudedeck.customTts({
    url: opts.url,
    voice: opts.voice,
    model: opts.model,
    apiKey: opts.apiKey,
    input: text,
  })
  if (!b64) throw new Error('empty audio')
  stopCustom()
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
