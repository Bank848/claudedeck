import { contextBridge, ipcRenderer } from 'electron'

/**
 * Minimal, Phase-1 surface: window controls + maximize-state subscription.
 * Later phases (node-pty CLI bridge) extend this API.
 */
const api = {
  minimize: (): void => ipcRenderer.send('window:minimize'),
  toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
  close: (): void => ipcRenderer.send('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChanged: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
    ipcRenderer.on('window:maximized-changed', listener)
    return () => ipcRenderer.removeListener('window:maximized-changed', listener)
  },
  /** App metadata, external links, and update checks. */
  app: {
    info: (): Promise<{ version: string; platform: string; arch: string; electron: string }> =>
      ipcRenderer.invoke('app:info'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),
    checkUpdate: (): Promise<{
      ok: boolean
      error?: string
      current?: string
      latest?: string
      url?: string
      hasUpdate?: boolean
    }> => ipcRenderer.invoke('app:check-update'),
  },

  /** Free Edge-TTS — returns base64 MP3. */
  edgeTts: (args: { text: string; voice?: string; rate?: string; pitch?: string }): Promise<string> =>
    ipcRenderer.invoke('tts:edge', args),
  /** Custom OpenAI-compatible TTS server — returns base64 MP3. */
  customTts: (args: {
    url: string
    voice: string
    model: string
    apiKey?: string
    input: string
  }): Promise<string> => ipcRenderer.invoke('tts:custom', args),

  /** Local Miku voice server lifecycle. */
  miku: {
    start: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('miku:start'),
    stop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('miku:stop'),
    status: (): Promise<boolean> => ipcRenderer.invoke('miku:status'),
    hasModel: (): Promise<boolean> => ipcRenderer.invoke('miku:has-model'),
    openModels: (): Promise<string> => ipcRenderer.invoke('miku:open-models'),
    downloadModel: (args: { url: string; index?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('miku:download-model', args),
    onLog: (cb: (line: string) => void): (() => void) => {
      const l = (_e: unknown, line: string): void => cb(line)
      ipcRenderer.on('miku:log', l)
      return () => ipcRenderer.removeListener('miku:log', l)
    },
    onStatus: (cb: (running: boolean) => void): (() => void) => {
      const l = (_e: unknown, running: boolean): void => cb(running)
      ipcRenderer.on('miku:status', l)
      return () => ipcRenderer.removeListener('miku:status', l)
    },
  },
}

contextBridge.exposeInMainWorld('claudedeck', api)

export type ClaudeDeckApi = typeof api
