import { contextBridge, ipcRenderer } from 'electron'
import type { AuthStatus } from './auth'
import type { GitStatus, Worktree, GitResult } from './git'

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
    status: (): Promise<'stopped' | 'starting' | 'ready'> => ipcRenderer.invoke('miku:status'),
    hasModel: (): Promise<boolean> => ipcRenderer.invoke('miku:has-model'),
    openModels: (): Promise<string> => ipcRenderer.invoke('miku:open-models'),
    downloadModel: (args: { url: string; index?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('miku:download-model', args),
    /** Render the fixed assistant phrases into the server cache ahead of first use. */
    prewarm: (phrases: string[]): Promise<{ ok: boolean; count?: number; error?: string }> =>
      ipcRenderer.invoke('miku:prewarm', phrases),
    onLog: (cb: (line: string) => void): (() => void) => {
      const l = (_e: unknown, line: string): void => cb(line)
      ipcRenderer.on('miku:log', l)
      return () => ipcRenderer.removeListener('miku:log', l)
    },
    onStatus: (cb: (phase: 'stopped' | 'starting' | 'ready') => void): (() => void) => {
      const l = (_e: unknown, phase: 'stopped' | 'starting' | 'ready'): void => cb(phase)
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
      permissionMode: 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default' | 'auto' | 'dontAsk'
      effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
      allowedTools?: string[]
      disallowedTools?: string[]
      additionalDirs?: string[]
      settings?: {
        allow?: string[]
        deny?: string[]
        ask?: string[]
        defaultMode?: string
        additionalDirectories?: string[]
      }
      settingSources?: string
    }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('claude:start', args),
    cancelTurn: (turnId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('claude:cancel', turnId),
    /** Answer a mid-turn tool-permission request. */
    respondPermission: (
      turnId: string,
      id: string,
      decision: 'allow' | 'deny',
      opts?: { input?: unknown; message?: string },
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('claude:permission-response', { turnId, id, decision, ...opts }),
    onPermissionRequest: (
      cb: (msg: { turnId: string; id: string; tool: string; input: unknown; toolUseId?: string }) => void,
    ): (() => void) => {
      const l = (_e: unknown, msg: { turnId: string; id: string; tool: string; input: unknown; toolUseId?: string }): void => cb(msg)
      ipcRenderer.on('claude:permission-request', l)
      return () => ipcRenderer.removeListener('claude:permission-request', l)
    },
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

  /** Hybrid session persistence: our metadata index + claude's JSONL transcripts. */
  sessions: {
    load: (): Promise<import('./sessionStore').StoredSession[]> => ipcRenderer.invoke('sessions:load'),
    save: (sessions: import('./sessionStore').StoredSession[]): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('sessions:save', sessions),
    transcript: (uuid: string): Promise<string | null> => ipcRenderer.invoke('sessions:transcript', uuid),
  },

  /** Disk-backed settings persistence (origin-independent: survives Vite dev-port drift). */
  settings: {
    load: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('settings:load'),
    save: (s: Record<string, unknown>): Promise<{ ok: boolean }> => ipcRenderer.invoke('settings:save', s),
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

  /** Git footer pickers — runs in the active session cwd. */
  git: {
    status: (cwd: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', cwd),
    branches: (cwd: string): Promise<string[]> => ipcRenderer.invoke('git:branches', cwd),
    checkout: (cwd: string, branch: string): Promise<GitResult> =>
      ipcRenderer.invoke('git:checkout', { cwd, branch }),
    worktrees: (cwd: string): Promise<Worktree[]> => ipcRenderer.invoke('git:worktrees', cwd),
    worktreeAdd: (
      args: { cwd: string; path: string; branch: string; newBranch?: boolean },
    ): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('git:worktree-add', args),
  },
}

contextBridge.exposeInMainWorld('claudedeck', api)

export type ClaudeDeckApi = typeof api
