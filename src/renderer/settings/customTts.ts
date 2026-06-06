/**
 * Advanced: a user-run local TTS server (OpenAI-compatible /v1/audio/speech).
 * Lets power users plug in an RVC / VITS "Miku" voice. Resource-heavy & may lag
 * on weak GPUs — surfaced with a warning in Settings. Synthesis goes through the
 * Electron main process (see preload `customTts`) to avoid renderer CORS.
 *
 * Sentence-chunk streaming: the reply is split into sentence-sized chunks; we
 * synth chunk i+1 while chunk i is playing. Because the Miku pipeline renders
 * faster than realtime (RTF < 1, see miku-server/_bench.py), playback never
 * starves, and time-to-first-sound drops from "whole-clip" to "first sentence"
 * (~3.9s → ~2s on a long reply). A generation counter lets stopCustom() / a new
 * speak preempt an in-flight reply cleanly — the basis for conversational
 * barge-in.
 */

let current: HTMLAudioElement | null = null
// Bumped by stopCustom() and by every new customSpeak(). An in-flight reply
// checks its captured value at each await boundary and bails the moment it is
// superseded, so a barge-in stops mid-sentence and stale chunks never play.
let generation = 0

function haltAudio(): void {
  if (current) {
    current.pause()
    current.src = ''
    current = null
  }
}

export function stopCustom(): void {
  generation++
  haltAudio()
}

interface CustomOpts {
  url: string
  voice: string
  model: string
  apiKey?: string
}

function isAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.claudedeck?.customTts
}

// Keep the first chunk short so the user hears something fast; pack later chunks
// larger to amortise the per-request edge-tts round-trip (~1.3–2.8s each).
const FIRST_MAX = 90
const MAX = 180

/**
 * Split text into chunks, first one small for a fast start. Prefers sentence
 * boundaries (.!?… etc.) and keeps whole sentences together when they fit; for
 * languages without sentence punctuation (Thai separates phrases with spaces) it
 * packs by word so a long reply still streams instead of becoming one big clip.
 */
export function splitIntoChunks(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences =
    clean.match(/[^.!?…。！？]+[.!?…。！？]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean]

  const chunks: string[] = []
  let buf = ''
  const cap = () => (chunks.length === 0 ? FIRST_MAX : MAX)
  const flush = () => {
    if (buf) {
      chunks.push(buf)
      buf = ''
    }
  }
  const addWord = (w: string) => {
    if (w.length > MAX) {
      // A single space-less token longer than a whole chunk (rare) → char-split.
      flush()
      for (let i = 0; i < w.length; i += MAX) chunks.push(w.slice(i, i + MAX))
      return
    }
    if (buf && buf.length + 1 + w.length > cap()) flush()
    buf = buf ? `${buf} ${w}` : w
  }

  for (const sent of sentences) {
    if (buf && buf.length + 1 + sent.length > cap()) flush()
    if (sent.length <= cap()) {
      buf = buf ? `${buf} ${sent}` : sent
    } else {
      flush() // start the long sentence on a fresh chunk
      for (const w of sent.split(' ')) addWord(w)
      flush()
    }
  }
  flush()
  return chunks
}

/** Synth one chunk via the custom server. Never rejects → null on failure. */
async function synthChunk(text: string, opts: CustomOpts): Promise<string | null> {
  try {
    const b64 = await window.claudedeck.customTts({
      url: opts.url,
      voice: opts.voice,
      model: opts.model,
      apiKey: opts.apiKey,
      input: text,
    })
    return b64 || null
  } catch {
    return null
  }
}

function playB64(b64: string): Promise<void> {
  return new Promise((resolve, reject) => {
    haltAudio()
    const audio = new Audio(`data:audio/mp3;base64,${b64}`)
    current = audio
    audio.onended = () => {
      if (current === audio) current = null
      resolve()
    }
    audio.onerror = () => reject(new Error('audio playback failed'))
    audio.play().catch(reject)
  })
}

/**
 * Synthesize via the custom server and play, streaming sentence by sentence.
 * Rejects only if the first chunk fails before any audio plays, so callers can
 * fall back to the system voice; later-chunk failures are skipped silently.
 */
export async function customSpeak(text: string, opts: CustomOpts): Promise<void> {
  if (!text.trim()) return
  if (!isAvailable()) throw new Error('custom-tts bridge unavailable')
  if (!opts.url) throw new Error('no custom server url')

  const myGen = ++generation
  const chunks = splitIntoChunks(text)
  if (!chunks.length) return

  // Prefetch the first chunk, then keep one chunk ahead of playback.
  let next: Promise<string | null> = synthChunk(chunks[0], opts)
  let played = false

  for (let i = 0; i < chunks.length; i++) {
    const b64 = await next
    if (generation !== myGen) return // preempted by stop / a newer reply
    next = i + 1 < chunks.length ? synthChunk(chunks[i + 1], opts) : Promise.resolve(null)

    if (!b64) {
      if (!played) throw new Error('empty audio') // server down → caller falls back
      continue // mid-reply hiccup → skip this chunk
    }

    try {
      await playB64(b64)
    } catch (err) {
      if (!played) throw err
    }
    if (generation !== myGen) return
    played = true
  }
}
