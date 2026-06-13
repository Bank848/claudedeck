/** The placeholder title a brand-new, unsent session carries (see emptySession). */
export const DEFAULT_TITLE = 'New session'

/** True when a session has never been named — still the placeholder or blank. */
export function isDefaultTitle(title: string | undefined): boolean {
  const t = (title ?? '').trim()
  return t === '' || t === DEFAULT_TITLE
}

const MAX_TITLE_LEN = 48

/**
 * Derive a tab title from the user's first message. Takes the first non-empty
 * line, strips the most common Markdown noise (heading/list/quote markers,
 * inline code/emphasis ticks), collapses whitespace, and truncates on a word
 * boundary with an ellipsis. Returns '' when there's nothing usable (e.g. an
 * image-only turn) so the caller can keep the placeholder.
 */
export function deriveSessionTitle(text: string): string {
  const firstLine = (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstLine) return ''

  const cleaned = firstLine
    .replace(/^#{1,6}\s+/, '') // heading markers
    .replace(/^[-*+]\s+/, '') // bullet markers
    .replace(/^>\s+/, '') // blockquote
    .replace(/[`*_~]/g, '') // inline code / emphasis
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''

  if (cleaned.length <= MAX_TITLE_LEN) return cleaned

  const slice = cleaned.slice(0, MAX_TITLE_LEN)
  const lastSpace = slice.lastIndexOf(' ')
  // Only break on a word boundary if it isn't chopping off most of the text
  // (e.g. a single long unbroken Thai/URL string has no spaces to break on).
  const base = lastSpace > MAX_TITLE_LEN * 0.6 ? slice.slice(0, lastSpace) : slice
  return `${base.trimEnd()}…`
}
