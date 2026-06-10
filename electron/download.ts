import { createWriteStream, unlinkSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { rejectUnsafeUrl } from './netGuard'

/**
 * Stream an HTTPS URL to `dest`, following redirects (GitHub release assets 302
 * to a CDN). Optional `onPercent` reports download progress from `content-length`.
 *
 * Shared by the RVC model download and the embedded-Python bootstrap so the
 * redirect/error/stream loop lives in exactly one place.
 */
export function downloadFile(
  url: string,
  dest: string,
  onPercent?: (pct: number) => void,
  depth = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // SSRF guard: validate the URL on entry AND again on every redirect hop (a
    // redirect Location to http:// or a private/metadata IP must not be followed).
    // The next-hop check happens at this same entry point via the recursive call.
    const bad = rejectUnsafeUrl(url)
    if (bad) return reject(new Error(bad))
    if (depth > 5) return reject(new Error('too many redirects'))
    httpsGet(url, (res) => {
      const code = res.statusCode ?? 0
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume()
        const loc = rejectUnsafeUrl(res.headers.location)
        if (loc) return reject(new Error(loc))
        downloadFile(res.headers.location, dest, onPercent, depth + 1).then(resolve, reject)
        return
      }
      if (code !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${code}`))
      }
      const total = Number(res.headers['content-length'] ?? 0)
      let got = 0
      const file = createWriteStream(dest)
      if (onPercent && total > 0) {
        res.on('data', (chunk: Buffer) => {
          got += chunk.length
          onPercent(Math.min(99, Math.round((got / total) * 100)))
        })
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', (err) => {
        try { unlinkSync(dest) } catch { /* best-effort cleanup of partial file */ }
        reject(err)
      })
    }).on('error', reject)
  })
}
