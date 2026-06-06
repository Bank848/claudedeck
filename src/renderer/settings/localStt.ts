/**
 * Fully local speech-to-text using Whisper via transformers.js (WASM/ONNX).
 * The model is fetched once from the HF CDN then cached in the browser, after
 * which transcription runs entirely on-device (no network).
 *
 * transformers.js is loaded with a dynamic import so it never bloats the main
 * bundle and only downloads when the user opts into the local engine.
 */

export type WhisperModel = 'Xenova/whisper-tiny' | 'Xenova/whisper-base'

export interface LoadProgress {
  status: string
  file?: string
  progress?: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let transcriber: any = null
let loadedModel = ''
let loadingPromise: Promise<any> | null = null

export async function loadTranscriber(
  model: WhisperModel,
  onProgress?: (p: LoadProgress) => void,
): Promise<void> {
  if (transcriber && loadedModel === model) return
  if (loadingPromise && loadedModel === model) {
    await loadingPromise
    return
  }
  loadedModel = model
  loadingPromise = (async () => {
    const tf: any = await import('@xenova/transformers')
    tf.env.allowLocalModels = false
    tf.env.useBrowserCache = true
    // Single-threaded WASM avoids the SharedArrayBuffer / crossOriginIsolated
    // requirement that file:// pages cannot satisfy.
    if (tf.env.backends?.onnx?.wasm) tf.env.backends.onnx.wasm.numThreads = 1
    transcriber = await tf.pipeline('automatic-speech-recognition', model, {
      quantized: true,
      progress_callback: onProgress,
    })
    return transcriber
  })()
  await loadingPromise
}

export function isModelReady(): boolean {
  return transcriber !== null
}

/** Transcribe 16 kHz mono audio. `lang` is the short tag ('th' | 'en'). */
export async function transcribe(audio: Float32Array, lang: 'th' | 'en'): Promise<string> {
  if (!transcriber) throw new Error('Model not loaded')
  const out = await transcriber(audio, {
    language: lang === 'th' ? 'thai' : 'english',
    task: 'transcribe',
    chunk_length_s: 30,
  })
  return (Array.isArray(out) ? out[0]?.text : out?.text ?? '').trim()
}

/* ───────────────────────────── microphone ──────────────────────────────── */

async function blobToMono16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer()
  const Ctx = window.AudioContext || (window as any).webkitAudioContext
  const ctx = new Ctx()
  const decoded = await ctx.decodeAudioData(buf)
  ctx.close()
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

/** Press-to-talk microphone recorder producing 16 kHz mono PCM for Whisper. */
export class MicRecorder {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: BlobPart[] = []

  async start(deviceId?: string): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    })
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start()
  }

  stop(): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      if (!this.recorder) return reject(new Error('Not recording'))
      this.recorder.onstop = async () => {
        try {
          const blob = new Blob(this.chunks, { type: 'audio/webm' })
          this.stream?.getTracks().forEach((t) => t.stop())
          this.stream = null
          this.recorder = null
          resolve(await blobToMono16k(blob))
        } catch (e) {
          reject(e as Error)
        }
      }
      this.recorder.stop()
    })
  }
}
