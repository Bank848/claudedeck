import { contextBridge, ipcRenderer } from 'electron'
import type { AuthStatus } from './auth'

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
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('app:pick-directory'),
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

  /** Real claude CLI backend (Slice A). */
  claude: {
    available: (): Promise<boolean> => ipcRenderer.invoke('claude:available'),
    startTurn: (args: {
      turnId: string
      prompt: string
      cwd: string
      sessionId?: string
      model?: string
      permissionMode: 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default'
    }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('claude:start', args),
    cancelTurn: (turnId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('claude:cancel', turnId),
    onEvent: (cb: (msg: { turnId: string; event: unknown }) => void): (() => void) => {
      const l = (_e: unknown, msg: { turnId: string; event: unknown }): void => cb(msg)
      ipcRenderer.on('claude:event', l)
      return () => ipcRenderer.removeListener('claude:event', l)
    },
    onStderr: (cb: (msg: { turnId: string; text: string }) => void): (() => void) => {
      const l = (_e: unknown, msg: { turnId: string; text: string }): void => cb(msg)
      ipcRenderer.on('claude:stderr', l)
      return () => ipcRenderer.removeListener('claude:stderr', l)
    },
    onDone: (cb: (msg: { turnId: string; code: number }) => void): (() => void) => {
      const l = (_e: unknown, msg: { turnId: string; code: number }): void => cb(msg)
      ipcRenderer.on('claude:done', l)
      return () => ipcRenderer.removeListener('claude:done', l)
    },
  },

  /** In-app auth: login / logout / status (Approach B). */
  auth: {
    status: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:status'),
    startLogin: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:login-start'),
    submitCode: (code: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('auth:login-code', code),
    cancelLogin: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('auth:login-cancel'),
    logout: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:logout'),
    onUrl: (cb: (m: { url: string }) => void): (() => void) => {
      const l = (_e: unknown, m: { url: string }): void => cb(m)
      ipcRenderer.on('auth:login-url', l)
      return () => ipcRenderer.removeListener('auth:login-url', l)
    },
    onError: (cb: (m: { text: string }) => void): (() => void) => {
      const l = (_e: unknown, m: { text: string }): void => cb(m)
      ipcRenderer.on('auth:login-error', l)
      return () => ipcRenderer.removeListener('auth:login-error', l)
    },
    onDone: (cb: (m: { ok: boolean; error?: string }) => void): (() => void) => {
      const l = (_e: unknown, m: { ok: boolean; error?: string }): void => cb(m)
      ipcRenderer.on('auth:login-done', l)
      return () => ipcRenderer.removeListener('auth:login-done', l)
    },
  },
}

contextBridge.exposeInMainWorld('claudedeck', api)

export type ClaudeDeckApi = typeof api
