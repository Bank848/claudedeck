import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { cancelSpeech } from './speech'
import { setTtsConfig } from './tts'

export type UiScale = 'small' | 'normal' | 'large'

export interface Settings {
  /** Show read-aloud (text-to-speech) controls on assistant messages. */
  readAloud: boolean
  /** Speech rate 0.7–1.6. */
  speechRate: number
  /** Speech pitch 0.5–2.0 (used by voice presets / anime styles). */
  speechPitch: number
  /** Preferred voice URI, or '' for the system default. */
  voiceURI: string
  /** Selected microphone deviceId for the local voice engine ('' = system default). */
  micDeviceId: string
  /** Enable the microphone (speech-to-text) button in the composer. */
  speechToText: boolean
  /** Hands-free voice commands to navigate the app (for blind users). */
  voiceCommands: boolean
  /** The assistant's spoken name (user can rename by voice). */
  assistantName: string
  /** Require saying the name before a command (call-sign mode, avoids misfires). */
  requireWakeWord: boolean
  /** Language for the voice assistant (recognition + spoken replies). */
  voiceLang: 'auto' | 'th-TH' | 'en-US'
  /** Speech-recognition engine: browser (online) or local Whisper (offline). */
  sttEngine: 'browser' | 'local'
  /** Whisper model size for the local engine. */
  whisperModel: 'Xenova/whisper-tiny' | 'Xenova/whisper-base'
  /** TTS engine: system (offline), Edge-TTS (free neural, online), or fish-speech (Miku/anime). */
  ttsEngine: 'system' | 'edge' | 'fish'
  /** Edge-TTS voice id (e.g. th-TH-PremwadeeNeural). */
  edgeVoice: string
  /** fish-speech server base URL. */
  fishUrl: string
  /** fish-speech reference/voice id (the cloned voice to speak with). */
  fishReferenceId: string
  /** Optional API key — set this to use Fish Audio cloud (api.fish.audio); blank for self-host. */
  fishApiKey: string
  /** Force-reduce animations regardless of OS setting. */
  reduceMotion: boolean
  /** Brighter text + stronger borders for low vision. */
  highContrast: boolean
  /** Interface zoom. */
  uiScale: UiScale
}

const DEFAULTS: Settings = {
  readAloud: false,
  speechRate: 1,
  speechPitch: 1,
  voiceURI: '',
  micDeviceId: '',
  speechToText: true,
  voiceCommands: false,
  assistantName: 'บีม',
  requireWakeWord: true,
  voiceLang: 'auto',
  sttEngine: 'browser',
  whisperModel: 'Xenova/whisper-base',
  ttsEngine: 'system',
  edgeVoice: 'th-TH-PremwadeeNeural',
  fishUrl: 'http://127.0.0.1:8080',
  fishReferenceId: '',
  fishApiKey: '',
  reduceMotion: false,
  highContrast: false,
  uiScale: 'normal',
}

const STORAGE_KEY = 'claudedeck.settings'
const ZOOM: Record<UiScale, number> = { small: 0.9, normal: 1, large: 1.15 }

interface SettingsContextValue {
  settings: Settings
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  reset: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    /* ignore corrupt storage */
  }
  return DEFAULTS
}

export function SettingsProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<Settings>(load)

  // Persist.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* ignore */
    }
  }, [settings])

  // Apply document-level effects.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('force-reduce-motion', settings.reduceMotion)
    root.classList.toggle('high-contrast', settings.highContrast)
    root.style.setProperty('zoom', String(ZOOM[settings.uiScale]))
  }, [settings.reduceMotion, settings.highContrast, settings.uiScale])

  // Publish TTS engine config to the routing layer.
  useEffect(() => {
    setTtsConfig({
      engine: settings.ttsEngine,
      edgeVoice: settings.edgeVoice,
      fishUrl: settings.fishUrl,
      fishReferenceId: settings.fishReferenceId,
      fishApiKey: settings.fishApiKey,
    })
  }, [
    settings.ttsEngine,
    settings.edgeVoice,
    settings.fishUrl,
    settings.fishReferenceId,
    settings.fishApiKey,
  ])

  // Stop any speech if read-aloud is turned off, and on Escape.
  useEffect(() => {
    if (!settings.readAloud) cancelSpeech()
  }, [settings.readAloud])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancelSpeech()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update: (key, val) => setSettings((s) => ({ ...s, [key]: val })),
      reset: () => setSettings(DEFAULTS),
    }),
    [settings],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
