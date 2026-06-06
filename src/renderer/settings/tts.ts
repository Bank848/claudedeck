/**
 * Unified speak() that routes to the chosen TTS engine:
 *  - 'system' → built-in SpeechSynthesis voices (offline, instant, pitch personas)
 *  - 'fish'   → local fish-speech server (Miku/anime), with system fallback on error
 *
 * SettingsContext publishes the current engine config via setTtsConfig().
 */
import { speak as systemSpeak, cancelSpeech as cancelSystem, isSpeechSupported } from './speech'
import { fishSpeak, stopFish } from './fishTts'

interface TtsConfig {
  engine: 'system' | 'fish'
  fishUrl: string
  fishReferenceId: string
  fishApiKey: string
}

let cfg: TtsConfig = { engine: 'system', fishUrl: '', fishReferenceId: '', fishApiKey: '' }

export function setTtsConfig(c: TtsConfig): void {
  cfg = c
}

interface SpeakOpts {
  rate?: number
  pitch?: number
  voiceURI?: string
  lang?: string
}

function systemSpeakPromise(text: string, opts: SpeakOpts): Promise<void> {
  if (!isSpeechSupported() || !text) return Promise.resolve()
  return new Promise((resolve) => systemSpeak(text, { ...opts, onEnd: () => resolve() }))
}

/** Speak via the active engine. Resolves when playback finishes. */
export function speakSmart(text: string, opts: SpeakOpts = {}): Promise<void> {
  if (cfg.engine === 'fish' && cfg.fishUrl) {
    return fishSpeak(text, {
      url: cfg.fishUrl,
      referenceId: cfg.fishReferenceId,
      apiKey: cfg.fishApiKey,
    }).catch(() => systemSpeakPromise(text, opts))
  }
  return systemSpeakPromise(text, opts)
}

export function cancelSmart(): void {
  stopFish()
  cancelSystem()
}
