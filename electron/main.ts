import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, createWriteStream, readdirSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { get as httpGet } from 'node:http'
import { EdgeTTS } from '@andresaya/edge-tts'
import { detectClaude, startTurn, cancelTurn, cancelAllTurns } from './claude'
import { getAuthStatus, startLogin, submitLoginCode, cancelLogin, logout } from './auth'
import { gitStatus, gitBranches, gitCheckout, gitWorktrees, gitWorktreeAdd } from './git'
import { safeSend } from './ipc'

const isDev = !app.isPackaged
const MIN_SPLASH_MS = 1100
const REPO = 'Bank848/claudedeck'

/** True if dotted-numeric version `a` is strictly newer than `b` (e.g. 0.2.0 > 0.1.0). */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null

/* ── Miku voice server (local Python) lifecycle ───────────────────────────── */
// 'starting' covers the long warm-up (pip check + torch + ContentVec + RVC model
// + faiss ≈ 20–40s) BEFORE the HTTP port accepts requests. Reporting 'ready' only
// after /v1/health returns 200 prevents the UI from inviting a POST into a server
// that is still booting — the old code flipped "running" at spawn, so an early
// Miku request hit connection-refused and was silently swallowed.
type MikuPhase = 'stopped' | 'starting' | 'ready'
let mikuProc: ChildProcess | null = null
let mikuPhase: MikuPhase = 'stopped'
let mikuHealthTimer: ReturnType<typeof setTimeout> | null = null

const MIKU_HEALTH_URL = 'http://127.0.0.1:5050/v1/health'
const MIKU_READY_TIMEOUT_MS = 90_000

function mikuDir(): string {
  return join(process.cwd(), 'miku-server')
}
function mikuModelsDir(): string {
  const d = join(mikuDir(), 'models')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}
function mikuLog(line: string): void {
  safeSend(mainWindow, 'miku:log', line)
}
function mikuSetPhase(phase: MikuPhase): void {
  mikuPhase = phase
  safeSend(mainWindow, 'miku:status', phase)
}

function clearMikuHealthTimer(): void {
  if (mikuHealthTimer) {
    clearTimeout(mikuHealthTimer)
    mikuHealthTimer = null
  }
}

/** Poll /v1/health until 200 (→ ready). Stays in 'starting' on timeout so the UI
 *  can tell the user to wait/retry rather than falsely reporting failure. */
function pollMikuHealth(deadline: number): void {
  if (!mikuProc) return // server stopped/exited while we were waiting
  if (Date.now() > deadline) {
    mikuLog('\n[ยังเริ่มไม่เสร็จใน 90 วินาที — ดู log ด้านบน หรือกดเริ่มใหม่]')
    return
  }
  const req = httpGet(MIKU_HEALTH_URL, (res) => {
    res.resume()
    if (res.statusCode === 200) mikuSetPhase('ready')
    else mikuHealthTimer = setTimeout(() => pollMikuHealth(deadline), 1000)
  })
  req.on('error', () => {
    mikuHealthTimer = setTimeout(() => pollMikuHealth(deadline), 1000)
  })
  req.setTimeout(2000, () => req.destroy())
}

function startMiku(): { ok: boolean; error?: string } {
  if (mikuProc) return { ok: true }
  const dir = mikuDir()
  if (!existsSync(join(dir, 'server.py'))) return { ok: false, error: 'miku-server not found' }
  // run.bat sets up the venv + deps on first run, then launches server.py.
  mikuProc = spawn('cmd.exe', ['/c', 'run.bat'], { cwd: dir, windowsHide: true })
  mikuSetPhase('starting')
  mikuProc.stdout?.on('data', (d) => mikuLog(String(d)))
  mikuProc.stderr?.on('data', (d) => mikuLog(String(d)))
  mikuProc.on('exit', (code) => {
    mikuLog(`\n[server exited: ${code}]`)
    mikuProc = null
    clearMikuHealthTimer()
    mikuSetPhase('stopped')
  })
  pollMikuHealth(Date.now() + MIKU_READY_TIMEOUT_MS)
  return { ok: true }
}

function stopMiku(): void {
  clearMikuHealthTimer()
  if (mikuProc?.pid) {
    // Kill the whole tree (cmd → python) on Windows.
    spawn('taskkill', ['/pid', String(mikuProc.pid), '/T', '/F'])
  }
  mikuProc = null
  mikuSetPhase('stopped')
}

function downloadModel(url: string, filename: string, depth = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'))
    const dest = join(mikuModelsDir(), filename)
    httpsGet(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        downloadModel(res.headers.location, filename, depth + 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const file = createWriteStream(dest)
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', reject)
    }).on('error', reject)
  })
}

/**
 * Splash is rendered from an inline data URL so it works identically in dev and
 * packaged builds (no on-disk path/asar resolution to get wrong).
 */
function splashMarkup(): string {
  const html = `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
    html,body { margin:0; height:100%; overflow:hidden; }
    body {
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px;
      background:#0B0D10; color:#F4F6F8;
      font-family: "Segoe UI", system-ui, sans-serif;
      -webkit-user-select:none; user-select:none;
    }
    .spark { width:54px; height:54px; }
    .title { font-size:20px; font-weight:600; letter-spacing:.3px; animation:pulse 1.8s ease-in-out infinite; }
    .sub { font-size:12px; color:#9AA2AD; }
    .ring {
      margin-top:6px; width:22px; height:22px; border-radius:50%;
      border:2px solid #252931; border-top-color:#D97757; animation:spin .8s linear infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .ring, .title { animation:none; }
    }
  </style></head>
  <body>
    <svg class="spark" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2l1.9 6.3L20 10l-6.1 1.7L12 18l-1.9-6.3L4 10l6.1-1.7L12 2z" fill="#D97757"/>
    </svg>
    <div class="title">ClaudeDeck</div>
    <div class="sub">Booting the deck&hellip;</div>
    <div class="ring"></div>
  </body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

function createSplash(): void {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 260,
    frame: false,
    resizable: false,
    transparent: false,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#0B0D10',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  splashWindow.loadURL(splashMarkup())
  splashWindow.once('ready-to-show', () => splashWindow?.show())
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#0B0D10',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const bootStart = Date.now()
  let finishedLoad = false

  const reveal = (): void => {
    if (!mainWindow) return
    const elapsed = Date.now() - bootStart
    const wait = Math.max(0, MIN_SPLASH_MS - elapsed)
    setTimeout(() => {
      splashWindow?.close()
      splashWindow = null
      mainWindow?.show()
      mainWindow?.focus()
    }, wait)
  }

  mainWindow.once('ready-to-show', () => {
    if (finishedLoad) reveal()
  })
  mainWindow.webContents.once('did-finish-load', () => {
    finishedLoad = true
    if (mainWindow?.isVisible() === false) reveal()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)

  // App meta + external links + update check (GitHub Releases).
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
  }))
  ipcMain.handle('app:open-external', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('app:pick-directory', async (): Promise<string | null> => {
    if (!mainWindow) return null
    // The splash window is alwaysOnTop; make sure it's gone and the main window
    // is focused, otherwise the modal picker can open BEHIND them ("nothing
    // shows"). Restore if minimized, then bring to front before opening.
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose working directory',
      properties: ['openDirectory'],
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle('app:check-update', async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { 'user-agent': 'ClaudeDeck', accept: 'application/vnd.github+json' },
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const data = (await res.json()) as { tag_name?: string; html_url?: string }
      const latest = (data.tag_name ?? '').replace(/^v/, '')
      const current = app.getVersion()
      return {
        ok: true,
        current,
        latest,
        url: data.html_url || `https://github.com/${REPO}/releases`,
        hasUpdate: !!latest && isNewer(latest, current),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Free Edge-TTS (Microsoft online neural voices) — runs here in the main
  // process because Chromium renderers can't open the Edge TTS socket directly.
  ipcMain.handle(
    'tts:edge',
    async (
      _e,
      args: { text: string; voice?: string; rate?: string; pitch?: string },
    ): Promise<string> => {
      const tts = new EdgeTTS()
      await tts.synthesize(args.text, args.voice || 'th-TH-PremwadeeNeural', {
        rate: args.rate ?? '+0%',
        pitch: args.pitch ?? '+0Hz',
      })
      return tts.toBase64()
    },
  )

  // Custom OpenAI-compatible TTS server (advanced; e.g. a local RVC/VITS Miku).
  // Done in main to avoid renderer CORS against the user's local server.
  ipcMain.handle(
    'tts:custom',
    async (
      _e,
      args: { url: string; voice: string; model: string; apiKey?: string; input: string },
    ): Promise<string> => {
      const base = args.url.replace(/\/+$/, '')
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (args.apiKey) headers.authorization = `Bearer ${args.apiKey}`
      const res = await fetch(`${base}/v1/audio/speech`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: args.model || 'tts-1',
          voice: args.voice,
          input: args.input,
          response_format: 'mp3',
        }),
      })
      if (!res.ok) throw new Error(`custom tts ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      return buf.toString('base64')
    },
  )

  // Miku voice server lifecycle (start/stop the local Python server from the UI).
  ipcMain.handle('miku:start', () => startMiku())
  ipcMain.handle('miku:stop', () => {
    stopMiku()
    return { ok: true }
  })
  ipcMain.handle('miku:status', () => mikuPhase)
  ipcMain.handle('miku:has-model', () => {
    try {
      const files = readdirSync(mikuModelsDir(), { recursive: true }) as string[]
      return files.some((f) => String(f).toLowerCase().endsWith('.pth'))
    } catch {
      return false
    }
  })
  ipcMain.handle('miku:open-models', () => shell.openPath(mikuModelsDir()))
  ipcMain.handle(
    'miku:download-model',
    async (_e, args: { url: string; index?: string }): Promise<{ ok: boolean; error?: string }> => {
      try {
        await downloadModel(args.url, 'miku.pth')
        if (args.index) await downloadModel(args.index, 'miku.index')
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  // ── Real claude CLI backend (Slice A) ──────────────────────────────────────
  ipcMain.handle('claude:available', async () => (await detectClaude()) !== null)
  ipcMain.handle('claude:start', (_e, args) => {
    if (!mainWindow) return { ok: false, error: 'no window' }
    return startTurn(mainWindow, args)
  })
  ipcMain.handle('claude:cancel', (_e, turnId: string) => {
    cancelTurn(turnId)
    return { ok: true }
  })

  // ── Auth (login/logout/status) ─────────────────────────────────────────────
  ipcMain.handle('auth:status', () => getAuthStatus())
  ipcMain.handle('auth:login-start', () => {
    if (!mainWindow) return { ok: false, error: 'no window' }
    return startLogin(mainWindow)
  })
  ipcMain.handle('auth:login-code', (_e, code: string) => submitLoginCode(code))
  ipcMain.handle('auth:login-cancel', () => {
    cancelLogin()
    return { ok: true }
  })
  ipcMain.handle('auth:logout', () => logout())

  // ── git (footer pickers) ──────────────────────────────────────────────────
  ipcMain.handle('git:status', (_e, cwd: string) => gitStatus(cwd))
  ipcMain.handle('git:branches', (_e, cwd: string) => gitBranches(cwd))
  ipcMain.handle('git:checkout', (_e, args: { cwd: string; branch: string }) =>
    gitCheckout(args.cwd, args.branch),
  )
  ipcMain.handle('git:worktrees', (_e, cwd: string) => gitWorktrees(cwd))
  ipcMain.handle(
    'git:worktree-add',
    (_e, args: { cwd: string; path: string; branch: string; newBranch?: boolean }) =>
      gitWorktreeAdd(args.cwd, args.path, args.branch, args.newBranch),
  )
}

app.whenReady().then(() => {
  registerIpc()
  createSplash()
  createMainWindow()

  // Notify renderer of maximize state changes so the control icon can update.
  const emitMaxState = (): void =>
    safeSend(mainWindow, 'window:maximized-changed', mainWindow?.isMaximized())
  app.on('browser-window-created', () => {
    mainWindow?.on('maximize', emitMaxState)
    mainWindow?.on('unmaximize', emitMaxState)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
  cancelAllTurns()
  cancelLogin()
  stopMiku()
})

app.on('window-all-closed', () => {
  cancelAllTurns()
  cancelLogin()
  stopMiku()
  if (process.platform !== 'darwin') app.quit()
})
