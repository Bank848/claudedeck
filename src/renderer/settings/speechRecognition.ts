/**
 * Speech-to-text (dictation) built on the Web Speech API's SpeechRecognition.
 * Available in Chromium/Electron as `webkitSpeechRecognition`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/* Minimal typings — SpeechRecognition is not in the standard DOM lib. */
interface SpeechRecognitionResultLike {
  0: { transcript: string }
  isFinal: boolean
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { length: number; [i: number]: SpeechRecognitionResultLike }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isDictationSupported(): boolean {
  return getCtor() !== null
}

interface UseDictation {
  supported: boolean
  listening: boolean
  start: () => void
  stop: () => void
  toggle: () => void
}

/**
 * @param onText called with each finalized transcript chunk.
 */
export function useDictation(onText: (text: string) => void, lang?: string): UseDictation {
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const langRef = useRef(lang)
  langRef.current = lang

  const supported = isDictationSupported()

  const stop = useCallback(() => {
    recRef.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor || recRef.current) return
    const rec = new Ctor()
    rec.lang = langRef.current || navigator.language || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        if (result.isFinal) {
          const text = result[0].transcript.trim()
          if (text) onTextRef.current(text)
        }
      }
    }
    rec.onend = () => {
      recRef.current = null
      setListening(false)
    }
    rec.onerror = () => {
      recRef.current = null
      setListening(false)
    }
    recRef.current = rec
    rec.start()
    setListening(true)
  }, [])

  const toggle = useCallback(() => {
    if (recRef.current) stop()
    else start()
  }, [start, stop])

  useEffect(() => () => recRef.current?.abort(), [])

  return { supported, listening, start, stop, toggle }
}
