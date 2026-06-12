import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { rejectUnsafeUrlAllowLoopback } from './netGuard'

/**
 * End-to-end shape of the `tts:custom` IPC handler: guard the renderer-supplied
 * base URL, then POST {base}/v1/audio/speech and read bytes back. Runs against a
 * real loopback HTTP server (OpenAI-TTS shaped, like the local Miku server on
 * http://127.0.0.1:5050) so the http-to-loopback path is proven, not just the
 * pure guard function.
 */
async function customTtsFetch(baseUrl: string, input: string): Promise<string> {
  const bad = rejectUnsafeUrlAllowLoopback(baseUrl)
  if (bad) throw new Error(bad)
  const base = baseUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: 'miku', input, response_format: 'mp3' }),
  })
  if (!res.ok) throw new Error(`custom tts ${res.status}`)
  return Buffer.from(await res.arrayBuffer()).toString('base64')
}

describe('tts:custom guard + fetch against a live loopback server', () => {
  let server: Server
  let baseUrl = ''
  const FAKE_MP3 = Buffer.from('fake-mp3-bytes')

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/audio/speech') {
        res.writeHead(200, { 'content-type': 'audio/mpeg' })
        res.end(FAKE_MP3)
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('no server address')
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    )
  })

  it('passes the guard and fetches audio from an http loopback server', async () => {
    const b64 = await customTtsFetch(baseUrl, 'สวัสดี')
    expect(Buffer.from(b64, 'base64')).toEqual(FAKE_MP3)
  })

  it('rejects a private-LAN http endpoint before any fetch happens', async () => {
    await expect(customTtsFetch('http://192.168.1.5:5050', 'x')).rejects.toThrow(
      'only https allowed',
    )
  })

  it('rejects the cloud metadata endpoint before any fetch happens', async () => {
    await expect(customTtsFetch('http://169.254.169.254', 'x')).rejects.toThrow(
      'only https allowed',
    )
  })
})
