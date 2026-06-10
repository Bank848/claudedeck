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
