const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./]

function isBlockedHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return PRIVATE_V4.some((re) => re.test(h))
  return false
}

/** https only, public host only. Returns null when safe, else a reason string. */
export function rejectUnsafeUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'invalid url'
  }
  if (u.protocol !== 'https:') return 'only https allowed'
  if (isBlockedHost(u.hostname)) return 'host not allowed'
  return null
}

function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '::1' || /^127\./.test(h)
}

/** Like rejectUnsafeUrl, but additionally permits plain-http loopback
 *  (127.x / ::1 / localhost) for user-pointed local servers — e.g. the Miku
 *  TTS server on http://127.0.0.1:5050. Non-loopback hosts keep the full
 *  guard: https only, no private/link-local/metadata ranges. */
export function rejectUnsafeUrlAllowLoopback(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'invalid url'
  }
  if ((u.protocol === 'http:' || u.protocol === 'https:') && isLoopbackHost(u.hostname)) return null
  return rejectUnsafeUrl(raw)
}
