import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { EdgeTTS } from '@andresaya/edge-tts'

const isDev = !app.isPackaged
const MIN_SPLASH_MS = 1100

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null

/* ── Miku voice server (local Python) lifecycle ───────────────────────────── */
let mikuProc: ChildProcess | null = null

function mikuDir(): string {
  return join(process.cwd(), 'miku-server')
}
function mikuModelsDir(): string {
  const d = join(mikuDir(), 'models')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}
function mikuLog(line: string): void {
  mainWindow?.webContents.send('miku:log', line)
}
function mikuSetRunning(running: boolean): void {
  mainWindow?.webContents.send('miku:status', running)
}

function startMiku(): { ok: boolean; error?: string } {
  if (mikuProc) return { ok: true }
  const dir = mikuDir()
  if (!existsSync(join(dir, 'server.py'))) return { ok: false, error: 'miku-server not found' }
  // run.bat sets up the venv + deps on first run, then launches server.py.
  mikuProc = spawn('cmd.exe', ['/c', 'run.bat'], { cwd: dir, windowsHide: true })
  mikuSetRunning(true)
  mikuProc.stdout?.on('data', (d) => mikuLog(String(d)))
  mikuProc.stderr?.on('data', (d) => mikuLog(String(d)))
  mikuProc.on('exit', (code) => {
    mikuLog(`\n[server exited: ${code}]`)
    mikuProc = null
    mikuSetRunning(false)
  })
  return { ok: true }
}

function stopMiku(): void {
  if (!mikuProc?.pid) return
  // Kill the whole tree (cmd → python) on Windows.
  spawn('taskkill', ['/pid', String(mikuProc.pid), '/T', '/F'])
  mikuProc = null
  mikuSetRunning(false)
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
  ipcMain.handle('miku:status', () => mikuProc !== null)
  ipcMain.handle('miku:has-model', () => existsSync(join(mikuModelsDir(), 'miku.pth')))
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
}

app.whenReady().then(() => {
  registerIpc()
  createSplash()
  createMainWindow()

  // Notify renderer of maximize state changes so the control icon can update.
  const emitMaxState = (): void =>
    mainWindow?.webContents.send('window:maximized-changed', mainWindow?.isMaximized())
  app.on('browser-window-created', () => {
    mainWindow?.on('maximize', emitMaxState)
    mainWindow?.on('unmaximize', emitMaxState)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => stopMiku())

app.on('window-all-closed', () => {
  stopMiku()
  if (process.platform !== 'darwin') app.quit()
})
