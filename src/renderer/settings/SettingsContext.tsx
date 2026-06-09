import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
  /** Name of the currently selected voice — also works as a wake word. */
  voiceName: string
  /** Require saying the name before a command (call-sign mode, avoids misfires). */
  requireWakeWord: boolean
  /** Language for the voice assistant (recognition + spoken replies). */
  voiceLang: 'auto' | 'th-TH' | 'en-US'
  /** Speech-recognition engine: browser (online) or local Whisper (offline). */
  sttEngine: 'browser' | 'local'
  /** Whisper model size for the local engine. */
  whisperModel: 'Xenova/whisper-tiny' | 'Xenova/whisper-base'
  /** TTS engine: system (offline), Edge-TTS (free), or a custom local server (advanced, e.g. RVC/VITS Miku). */
  ttsEngine: 'system' | 'edge' | 'custom'
  /** Edge-TTS voice id (e.g. th-TH-PremwadeeNeural). */
  edgeVoice: string
  /** Custom OpenAI-compatible TTS server base URL (advanced; e.g. local RVC/VITS). */
  customUrl: string
  /** Custom server voice name. */
  customVoice: string
  /** Custom server model name (OpenAI-style; default tts-1). */
  customModel: string
  /** Optional bearer key for the custom server. */
  customApiKey: string
  /** Force-reduce animations regardless of OS setting. */
  reduceMotion: boolean
  /** Brighter text + stronger borders for low vision. */
  highContrast: boolean
  /** Interface zoom. */
  uiScale: UiScale
  /** Built-in screen-reader mode: announce view changes etc. via the live region + TTS. */
  screenReaderMode: boolean
  /** Id of the chosen voice in the unified catalog (e.g. "sys:miku", "edge:…", "miku:rvc"). */
  voiceChoiceId: string
}

const DEFAULTS: Settings = {
  readAloud: false,
  speechRate: 1,
  speechPitch: 1,
  voiceURI: '',
  micDeviceId: '',
  speechToText: true,
  voiceCommands: false,
  assistantName: 'กุ้ง',
  voiceName: '',
  requireWakeWord: true,
  voiceLang: 'auto',
  sttEngine: 'local',
  whisperModel: 'Xenova/whisper-base',
  ttsEngine: 'system',
  edgeVoice: 'th-TH-PremwadeeNeural',
  customUrl: 'http://127.0.0.1:5050',
  customVoice: 'miku',
  customModel: 'tts-1',
  customApiKey: '',
  reduceMotion: false,
  highContrast: false,
  uiScale: 'normal',
  screenReaderMode: false,
  voiceChoiceId: '',
}

const STORAGE_KEY = 'claudedeck.settings'
const ZOOM: Record<UiScale, number> = { small: 0.9, normal: 1, large: 1.15 }

interface SettingsContextValue {
  settings: Settings
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  reset: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

// Merge a stored (partial) settings object over DEFAULTS and apply the fixed-field
// coercions. STT is pinned to local Whisper Base (the picker was removed for simplicity).
function withDefaults(partial: Partial<Settings>): Settings {
  return { ...DEFAULTS, ...partial, sttEngine: 'local', whisperModel: 'Xenova/whisper-base' }
}

// Synchronous localStorage read for instant first paint (origin-keyed fast cache).
// The durable store is disk (via the main process); see SettingsProvider hydration.
function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return withDefaults(JSON.parse(raw) as Partial<Settings>)
  } catch {
    /* ignore corrupt storage */
  }
  return DEFAULTS
}

const DISK_DEBOUNCE_MS = 400

export function SettingsProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<Settings>(load)

  // Disk is the durable store; localStorage is only a synchronous fast-cache. Don't
  // write to disk until the initial disk load resolves, or default/cached values
  // would clobber the persisted file before we've read it. (Mirrors App.tsx sessions.)
  const hydratedRef = useRef(false)
  useEffect(() => {
    const api = window.claudedeck?.settings
    if (!api) {
      // No bridge (vitest / web preview): localStorage-only, persist immediately.
      hydratedRef.current = true
      return
    }
    void api.load().then((stored) => {
      if (stored) {
        // Disk wins.
        setSettings(withDefaults(stored as Partial<Settings>))
      } else if (localStorage.getItem(STORAGE_KEY) != null) {
        // First run after the localStorage→disk migration: seed disk from the cache.
        void api.save(settings as unknown as Record<string, unknown>)
      }
      hydratedRef.current = true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist: localStorage synchronously (fast cache), disk debounced (durable).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* ignore */
    }
    if (!hydratedRef.current) return
    const api = window.claudedeck?.settings
    if (!api) return
    const t = setTimeout(() => {
      void api.save(settings as unknown as Record<string, unknown>)
    }, DISK_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [settings])

  // Quit-flush: the debounce can drop the final change if the app closes right after
  // it. Flush un-debounced to disk on unload. (Mirrors App.tsx sessions.)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  useEffect(() => {
    const flush = (): void => {
      const api = window.claudedeck?.settings
      if (hydratedRef.current && api) void api.save(settingsRef.current as unknown as Record<string, unknown>)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // Apply document-level effects.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('force-reduce-motion', settings.reduceMotion)
    root.classList.toggle('high-contrast', settings.highContrast)
    // Scale the root font-size (rem base) instead of CSS `zoom`. `zoom` scaled the
    // whole shell past the viewport and clipped the right/bottom edges at "large";
    // font-size grows only rem-based content inside its own scroll regions.
    const scale = ZOOM[settings.uiScale]
    root.style.removeProperty('zoom') // clear any value persisted by older builds
    root.style.fontSize = scale === 1 ? '' : `${16 * scale}px`
  }, [settings.reduceMotion, settings.highContrast, settings.uiScale])

  // Publish TTS engine config to the routing layer.
  useEffect(() => {
    setTtsConfig({
      engine: settings.ttsEngine,
      edgeVoice: settings.edgeVoice,
      customUrl: settings.customUrl,
      customVoice: settings.customVoice,
      customModel: settings.customModel,
      customApiKey: settings.customApiKey,
    })
  }, [
    settings.ttsEngine,
    settings.edgeVoice,
    settings.customUrl,
    settings.customVoice,
    settings.customModel,
    settings.customApiKey,
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
