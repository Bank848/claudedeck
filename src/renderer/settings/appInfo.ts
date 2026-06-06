/**
 * App metadata, external links, and update checks — thin renderer wrappers over
 * the preload `window.claudedeck.app` bridge. All calls guard for the bridge
 * being absent (e.g. the browser-based visual preview) and never throw.
 */

export type AppInfo = { version: string; platform: string; arch: string; electron: string }
export type UpdateResult = {
  ok: boolean
  error?: string
  current?: string
  latest?: string
  url?: string
  hasUpdate?: boolean
}

const bridge = (): Window['claudedeck'] | undefined =>
  typeof window !== 'undefined' ? window.claudedeck : undefined

export async function getAppInfo(): Promise<AppInfo | null> {
  try {
    return (await bridge()?.app.info()) ?? null
  } catch {
    return null
  }
}

export async function checkForUpdate(): Promise<UpdateResult> {
  try {
    return (await bridge()?.app.checkUpdate()) ?? { ok: false, error: 'unavailable' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function openExternal(url: string): void {
  void bridge()?.app.openExternal(url)
}

const REPO_URL = 'https://github.com/Bank848/claudedeck'

/** Prefilled GitHub "new issue" URL with the app/OS version baked into the body. */
export function reportBugUrl(info: AppInfo | null): string {
  const body = [
    '## What happened?',
    '',
    '',
    '## Steps to reproduce',
    '',
    '1. ',
    '',
    '## Environment',
    `- ClaudeDeck: ${info?.version ?? '?'}`,
    `- OS: ${info?.platform ?? '?'} (${info?.arch ?? '?'})`,
    `- Electron: ${info?.electron ?? '?'}`,
  ].join('\n')
  const q = new URLSearchParams({ title: '[bug] ', body, labels: 'bug' })
  return `${REPO_URL}/issues/new?${q.toString()}`
}
