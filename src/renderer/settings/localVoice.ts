/** Push-to-talk voice control using the fully local Whisper engine. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadTranscriber, transcribe, MicRecorder, type WhisperModel } from './localStt'

export type LocalVoiceStatus = 'idle' | 'loading' | 'ready' | 'listening' | 'thinking' | 'error'

interface UseLocalVoiceArgs {
  enabled: boolean
  model: WhisperModel
  lang: 'th' | 'en'
  deviceId?: string
  onText: (text: string) => void
}

interface UseLocalVoice {
  status: LocalVoiceStatus
  progress: number
  error: string
  talking: boolean
  startTalk: () => Promise<void>
  stopTalk: () => Promise<void>
}

export function useLocalVoice({
  enabled,
  model,
  lang,
  deviceId,
  onText,
}: UseLocalVoiceArgs): UseLocalVoice {
  const [status, setStatus] = useState<LocalVoiceStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const recRef = useRef<MicRecorder | null>(null)
  const onTextRef = useRef(onText)
  const langRef = useRef(lang)
  const deviceRef = useRef(deviceId)
  onTextRef.current = onText
  langRef.current = lang
  deviceRef.current = deviceId

  // Load (download + cache) the model when the local engine is enabled.
  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }
    let cancelled = false
    setError('')
    setStatus('loading')
    loadTranscriber(model, (p) => {
      if (typeof p.progress === 'number') setProgress(Math.round(p.progress))
    })
      .then(() => !cancelled && setStatus('ready'))
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message ?? String(e))
          setStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [enabled, model])

  const startTalk = useCallback(async () => {
    setStatus((s) => {
      if (s !== 'ready') return s
      return 'listening'
    })
    if (recRef.current) return
    try {
      const rec = new MicRecorder()
      recRef.current = rec
      await rec.start(deviceRef.current)
    } catch (e) {
      recRef.current = null
      setError(e instanceof Error ? e.message : String(e))
      setStatus('ready')
    }
  }, [])

  const stopTalk = useCallback(async () => {
    const rec = recRef.current
    if (!rec) return
    recRef.current = null
    setStatus('thinking')
    try {
      const audio = await rec.stop()
      const text = await transcribe(audio, langRef.current)
      if (text) onTextRef.current(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStatus('ready')
    }
  }, [])

  return { status, progress, error, talking: status === 'listening', startTalk, stopTalk }
}
