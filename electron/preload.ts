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
  /** Free Edge-TTS — returns base64 MP3. */
  edgeTts: (args: { text: string; voice?: string; rate?: string; pitch?: string }): Promise<string> =>
    ipcRenderer.invoke('tts:edge', args),
}

contextBridge.exposeInMainWorld('claudedeck', api)

export type ClaudeDeckApi = typeof api
