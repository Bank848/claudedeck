import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { EdgeTTS } from '@andresaya/edge-tts'

const isDev = !app.isPackaged
const MIN_SPLASH_MS = 1100

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
