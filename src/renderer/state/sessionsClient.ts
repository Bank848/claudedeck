import type { StoredSession } from '@/cli/types'

function bridge() {
  return typeof window !== 'undefined' ? (window as { claudedeck?: { sessions?: {
    load: () => Promise<StoredSession[]>
    save: (s: StoredSession[]) => Promise<{ ok: boolean }>
    transcript: (uuid: string) => Promise<string | null>
  } } }).claudedeck?.sessions : undefined
}

export async function loadIndex(): Promise<StoredSession[]> { return (await bridge()?.load()) ?? [] }
export async function saveIndex(sessions: StoredSession[]): Promise<void> { await bridge()?.save(sessions) }
export async function loadTranscript(uuid: string): Promise<string | null> { return (await bridge()?.transcript(uuid)) ?? null }
