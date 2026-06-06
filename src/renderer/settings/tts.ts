/**
 * Unified speak() that routes to the chosen TTS engine:
 *  - 'system' → built-in SpeechSynthesis voices (offline, instant, pitch personas)
 *  - 'fish'   → local fish-speech server (Miku/anime), with system fallback on error
 *
 * SettingsContext publishes the current engine config via setTtsConfig().
 */
import { speak as systemSpeak, cancelSpeech as cancelSystem, isSpeechSupported } from './speech'
import { fishSpeak, stopFish } from './fishTts'
import { edgeSpeak, stopEdge } from './edgeTts'

interface TtsConfig {
  engine: 'system' | 'edge' | 'fish'
  edgeVoice: string
  fishUrl: string
  fishReferenceId: string
  fishApiKey: string
}

let cfg: TtsConfig = {
  engine: 'system',
  edgeVoice: 'th-TH-PremwadeeNeural',
  fishUrl: '',
  fishReferenceId: '',
  fishApiKey: '',
}

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
  if (cfg.engine === 'edge') {
    return edgeSpeak(text, { voice: cfg.edgeVoice, rate: opts.rate, pitch: opts.pitch }).catch(() =>
      systemSpeakPromise(text, opts),
    )
  }
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
  stopEdge()
  stopFish()
  cancelSystem()
}
