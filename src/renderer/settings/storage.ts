/**
 * App storage helpers. The only thing that accumulates on disk is the local
 * Whisper model cache (downloaded once by transformers.js into the browser
 * Cache Storage / IndexedDB). TTS audio is in-memory and freed after playback.
 */

/** Best-effort estimate of cached bytes used by the app. */
export async function estimateUsage(): Promise<number> {
  try {
    const est = await navigator.storage?.estimate?.()
    return est?.usage ?? 0
  } catch {
    return 0
  }
}

/** Clear downloaded model caches (Cache Storage + IndexedDB). Keeps localStorage settings. */
export async function clearCachedData(): Promise<void> {
  // Cache Storage (transformers.js model cache lives here).
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
  }
  // IndexedDB (onnxruntime / transformers may use it).
  const idb = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }
  if (idb.databases) {
    const dbs = await idb.databases()
    await Promise.all(
      dbs.map((d) => (d.name ? new Promise<void>((res) => {
        const req = indexedDB.deleteDatabase(d.name!)
        req.onsuccess = req.onerror = req.onblocked = () => res()
      }) : Promise.resolve())),
    )
  }
}

export function formatBytes(n: number): string {
  if (n <= 0) return '0 MB'
  const mb = n / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(1)} MB`
}
