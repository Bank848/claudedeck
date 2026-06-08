const KEY = 'claudedeck.recentFolders'
const CAP = 12

/** Pure: prepend `path`, dedupe (case-sensitive exact), drop blanks, cap length. */
export function addRecent(list: string[], path: string): string[] {
  const p = path.trim()
  if (!p) return list
  return [p, ...list.filter((x) => x !== p)].slice(0, CAP)
}

export function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, CAP) : []
  } catch {
    return []
  }
}

export function recordRecent(path: string): string[] {
  const next = addRecent(loadRecents(), path)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore quota errors */
  }
  return next
}

/** Display label: last path segment (handles both / and \\), fallback to full. */
export function folderLabel(path: string): string {
  if (!path) return 'No folder'
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || path
}
