/**
 * Client for a local fish-speech (OpenAudio) server.
 * Run the server on the user's machine:
 *   python tools/api_server.py --listen 0.0.0.0:8080 ...
 * then POST msgpack to /v1/tts. Audio is returned as MP3 bytes.
 */
import { encode } from '@msgpack/msgpack'

let current: HTMLAudioElement | null = null

export function stopFish(): void {
  if (current) {
    current.pause()
    current.src = ''
    current = null
  }
}

interface FishOptions {
  url: string
  referenceId?: string
  /** Bearer token for Fish Audio cloud (api.fish.audio); omit for self-host. */
  apiKey?: string
  signal?: AbortSignal
}

/** Synthesize `text` via fish-speech and play it. Rejects on any failure. */
export async function fishSpeak(text: string, opts: FishOptions): Promise<void> {
  if (!text.trim()) return
  const base = opts.url.replace(/\/+$/, '')
  const body = encode({
    text,
    reference_id: opts.referenceId || null,
    format: 'mp3',
    normalize: true,
    streaming: false,
  })

  const headers: Record<string, string> = { 'content-type': 'application/msgpack' }
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`

  const res = await fetch(`${base}/v1/tts`, {
    method: 'POST',
    headers,
    body,
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(`fish-speech ${res.status}`)

  const buf = await res.arrayBuffer()
  const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }))
  stopFish()
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(blobUrl)
    current = audio
    audio.onended = () => {
      URL.revokeObjectURL(blobUrl)
      if (current === audio) current = null
      resolve()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(blobUrl)
      reject(new Error('audio playback failed'))
    }
    audio.play().catch(reject)
  })
}

/** Quick reachability check for the server (for the settings Test button). */
export async function fishHealth(url: string): Promise<boolean> {
  try {
    const base = url.replace(/\/+$/, '')
    const res = await fetch(`${base}/v1/health`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}
