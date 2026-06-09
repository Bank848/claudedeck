/**
 * Hands-free voice commands for blind users: a continuous SpeechRecognition
 * listener that matches spoken phrases to app actions and speaks confirmation.
 */
import { useEffect, useRef, useState } from 'react'
import { isDictationSupported } from './speechRecognition'
import { speakSmart } from './tts'
import { voiceGreeting } from './prewarmPhrases'

export interface VoiceCommand {
  /** Lowercase phrases; a transcript that includes any one triggers the action. */
  phrases: string[]
  /** What to do when matched. */
  run: () => void
  /** Spoken + shown confirmation, e.g. "Opened settings". */
  confirm: string
  /** Short human label for the help list. */
  label: string
}

/**
 * Match a transcript to a command and run it. Blind users speak natural
 * sentences ("ช่วยอ่านให้ฟังหน่อย"), so we substring-match each phrase against
 * the whole transcript and let the LONGEST (most specific) matching phrase win —
 * this stops a short Thai keyword (e.g. "งาน") from hijacking a longer sentence
 * (e.g. "เริ่มทำงานต่อ"). Ties keep declaration order (first wins).
 */
export function dispatchCommand(
  commands: VoiceCommand[],
  raw: string,
  lang = 'en-US',
): VoiceCommand | null {
  const t = raw.toLowerCase().trim()
  let best: VoiceCommand | null = null
  let bestLen = 0
  for (const c of commands) {
    for (const p of c.phrases) {
      const lp = p.toLowerCase()
      if (lp && t.includes(lp) && lp.length > bestLen) {
        best = c
        bestLen = lp.length
      }
    }
  }
  if (best) {
    best.run()
    if (best.confirm) void speakSmart(best.confirm, { rate: 1.05, lang })
  }
  return best
}

/* Minimal SpeechRecognition typings (not in the standard DOM lib). */
interface RecResult {
  0: { transcript: string }
  isFinal: boolean
}
interface RecEvent {
  resultIndex: number
  results: { length: number; [i: number]: RecResult }
}
interface Rec {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: RecEvent) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}
function getCtor(): (new () => Rec) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

interface UseVoiceCommands {
  supported: boolean
  listening: boolean
  lastHeard: string
}

/**
 * Continuous recognition that hands each final transcript to `onResult`.
 * Matching / wake-word / rename logic lives in the caller (App).
 */
export function useVoiceCommands(
  enabled: boolean,
  lang: string,
  onResult: (transcript: string) => void,
): UseVoiceCommands {
  const [listening, setListening] = useState(false)
  const [lastHeard, setLastHeard] = useState('')
  const recRef = useRef<Rec | null>(null)
  const enabledRef = useRef(enabled)
  const onResultRef = useRef(onResult)
  enabledRef.current = enabled
  onResultRef.current = onResult

  const supported = isDictationSupported()

  useEffect(() => {
    if (!enabled || !supported) return
    const Ctor = getCtor()
    if (!Ctor) return

    let stopped = false
    const isThai = lang.toLowerCase().startsWith('th')

    const match = (raw: string): void => {
      setLastHeard(raw.toLowerCase().trim())
      onResultRef.current(raw)
    }

    const begin = (): void => {
      if (stopped) return
      const rec = new Ctor()
      rec.lang = lang || navigator.language || 'en-US'
      rec.continuous = true
      rec.interimResults = false
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) match(e.results[i][0].transcript)
        }
      }
      rec.onend = () => {
        recRef.current = null
        setListening(false)
        if (!stopped && enabledRef.current) window.setTimeout(begin, 300)
      }
      rec.onerror = () => {
        recRef.current = null
        setListening(false)
      }
      recRef.current = rec
      try {
        rec.start()
        setListening(true)
      } catch {
        /* already started */
      }
    }

    void speakSmart(voiceGreeting(isThai), { rate: 1.05, lang })
    begin()

    return () => {
      stopped = true
      recRef.current?.abort()
      recRef.current = null
      setListening(false)
    }
  }, [enabled, supported, lang])

  return { supported, listening, lastHeard }
}
