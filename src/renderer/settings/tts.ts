/**
 * Unified speak() that routes to the chosen TTS engine:
 *  - 'system' → built-in SpeechSynthesis voices (offline, instant, pitch personas)
 *  - 'edge'   → free Edge-TTS neural voices (online, no key), system fallback on error
 *
 * Both engines work out of the box for any user. SettingsContext publishes the
 * current config via setTtsConfig().
 */
import { speak as systemSpeak, cancelSpeech as cancelSystem, isSpeechSupported } from './speech'
import { edgeSpeak, stopEdge } from './edgeTts'
import { customSpeak, stopCustom } from './customTts'

interface TtsConfig {
  engine: 'system' | 'edge' | 'custom'
  edgeVoice: string
  customUrl: string
  customVoice: string
  customModel: string
  customApiKey: string
}

let cfg: TtsConfig = {
  engine: 'system',
  edgeVoice: 'th-TH-PremwadeeNeural',
  customUrl: '',
  customVoice: '',
  customModel: 'tts-1',
  customApiKey: '',
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
  if (cfg.engine === 'custom' && cfg.customUrl) {
    return customSpeak(text, {
      url: cfg.customUrl,
      voice: cfg.customVoice,
      model: cfg.customModel,
      apiKey: cfg.customApiKey,
    }).catch(() => systemSpeakPromise(text, opts))
  }
  return systemSpeakPromise(text, opts)
}

export function cancelSmart(): void {
  stopEdge()
  stopCustom()
  cancelSystem()
}
