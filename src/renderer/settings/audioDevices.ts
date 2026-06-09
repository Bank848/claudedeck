/** Enumerate microphones and provide a live input-level meter for testing. */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface AudioInput {
  deviceId: string
  label: string
}

export function useAudioInputs(): { inputs: AudioInput[]; refresh: () => Promise<void> } {
  const [inputs, setInputs] = useState<AudioInput[]>([])

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      // Request permission first so device labels are populated.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      /* permission denied — labels may be blank */
    }
    const devices = await navigator.mediaDevices.enumerateDevices()
    setInputs(
      devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
    )
  }, [])

  useEffect(() => {
    refresh()
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
  }, [refresh])

  return { inputs, refresh }
}

/**
 * Record a short mic clip and play it straight back. A visual level meter is
 * useless to a blind user (our primary audience), so the real confirmation is
 * audible: record → stop → hear yourself. Playback (not live monitoring) avoids
 * the speaker→mic feedback howl.
 */
export function useMicMonitor(deviceId: string): {
  recording: boolean
  start: () => Promise<void>
  stopAndPlay: () => void
} {
  const [recording, setRecording] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback(async () => {
    if (recRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
      streamRef.current = stream
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size) {
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audio.onended = () => URL.revokeObjectURL(url)
          void audio.play().catch(() => URL.revokeObjectURL(url))
        }
      }
      rec.start()
      recRef.current = rec
      setRecording(true)
    } catch {
      /* permission denied / no device */
    }
  }, [deviceId])

  const stopAndPlay = useCallback(() => {
    recRef.current?.stop() // onstop builds the clip and plays it back
    recRef.current = null
    setRecording(false)
  }, [])

  useEffect(
    () => () => {
      recRef.current?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  return { recording, start, stopAndPlay }
}

/**
 * Live mic level (0–1) while `active`, for the chosen device — lets the user
 * confirm their microphone is picking up sound before testing voice commands.
 */
export function useMicLevel(active: boolean, deviceId: string): number {
  const [level, setLevel] = useState(0)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!active) {
      setLevel(0)
      return
    }
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let stopped = false

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        })
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        ctx = new Ctx()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = (): void => {
          if (stopped) return
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128
            sum += v * v
          }
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3))
          rafRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        /* ignore */
      }
    })()

    return () => {
      stopped = true
      cancelAnimationFrame(rafRef.current)
      stream?.getTracks().forEach((t) => t.stop())
      ctx?.close()
    }
  }, [active, deviceId])

  return level
}
