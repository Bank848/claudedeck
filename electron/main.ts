import { app, shell, BrowserWindow, ipcMain, dialog, session, Notification } from 'electron'
import { join } from 'node:path'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { totalmem } from 'node:os'
import { request as httpsRequest } from 'node:https'
import { get as httpGet } from 'node:http'
import { EdgeTTS } from '@andresaya/edge-tts'
import { decide, type Probe } from './mikuPreflight'
import { prepareMiku, type SetupProgress } from './mikuSetup'
import { downloadFile } from './download'
import { rejectUnsafeUrl, rejectUnsafeUrlAllowLoopback } from './netGuard'
import { detectClaude, startTurn, cancelTurn, cancelAllTurns, respondPermission, setSpawnTaskMcpConfig } from './claude'
import { writeSpawnTaskMcpConfig } from './mcp/spawnTaskConfig'
import { classifyTurn, type Tier } from './modelClassifier'
import type { PermissionDecision } from './permissionProtocol'
import { getAuthStatus, startLogin, submitLoginCode, cancelLogin, logout } from './auth'
import { gitStatus, gitBranches, gitCheckout, gitWorktrees, gitWorktreeAdd, gitForkWorktree } from './git'
import { loadIndex, saveIndex, readTranscript, type StoredSession } from './sessionStore'
import { loadSettings, saveSettings } from './settingsStore'
import { safeSend, safeHandle, errMsg } from './ipc'
import { notificationContent, type NotifyKind } from './attentionNotify'

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

/* ── In-app auto-update (electron-updater, GitHub Releases) ────────────────── */
// electron-updater is LAZY-imported inside getUpdater(): in v6 `autoUpdater` can
// throw at import time when there's no `app-update.yml` (i.e. every dev run), so a
// top-level `import 'electron-updater'` would crash `electron-vite dev`. Importing
// it only inside the packaged-guarded handlers keeps dev startup clean.
// Promise-based guard prevents duplicate event registration when updater:check and
// updater:download IPC calls arrive concurrently before the lazy import resolves.
type AutoUpdater = import('electron-updater').AppUpdater
let updaterPromise: Promise<AutoUpdater> | null = null
function getUpdater(): Promise<AutoUpdater> {
  if (!updaterPromise) {
    updaterPromise = import('electron-updater').then(({ autoUpdater }) => {
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.on('update-available', (i) =>
        safeSend(mainWindow, 'updater:available', { version: i.version }),
      )
      autoUpdater.on('update-not-available', () => safeSend(mainWindow, 'updater:none', {}))
      autoUpdater.on('download-progress', (p) =>
        safeSend(mainWindow, 'updater:progress', { percent: p.percent }),
      )
      autoUpdater.on('update-downloaded', () => safeSend(mainWindow, 'updater:downloaded', {}))
      autoUpdater.on('error', (e) => safeSend(mainWindow, 'updater:error', { error: errMsg(e) }))
      return autoUpdater
    })
  }
  return updaterPromise
}

/* ── Miku voice server (local Python) lifecycle ───────────────────────────── */
// 'starting' covers the long warm-up (pip check + torch + ContentVec + RVC model
// + faiss ≈ 20–40s) BEFORE the HTTP port accepts requests. Reporting 'ready' only
// after /v1/health returns 200 prevents the UI from inviting a POST into a server
// that is still booting — the old code flipped "running" at spawn, so an early
// Miku request hit connection-refused and was silently swallowed.
type MikuPhase = 'stopped' | 'starting' | 'ready' | 'error'
let mikuProc: ChildProcess | null = null
let mikuPhase: MikuPhase = 'stopped'
let mikuHealthTimer: ReturnType<typeof setTimeout> | null = null

const MIKU_HEALTH_URL = 'http://127.0.0.1:5050/v1/health'
const MIKU_PREWARM_URL = 'http://127.0.0.1:5050/v1/prewarm'
const MIKU_READY_TIMEOUT_MS = 90_000

// torch channel + embedded-python path resolved by miku:setup; startMiku passes
// them to run.bat via env. Defaults work for a direct start with a system py.
let mikuTorch: 'cu124' | 'cpu' = 'cpu'
let mikuPythonExe = ''
// Cached from the last miku:preflight so miku:setup (clicked right after) doesn't
// re-spawn wmic/PowerShell + re-probe the network. Null until the first preflight.
let lastProbe: Probe | null = null

function mikuDir(): string {
  // READ-ONLY source: server.py, rvc/, run.bat, requirements.txt. Dev: the repo's
  // miku-server. Packaged: bundled via electron-builder `extraResources` into
  // <resourcesPath>/miku-server. process.cwd() is unreliable when packaged (it's
  // wherever the .exe was launched from — e.g. System32 from the Start menu), so
  // resolve against resourcesPath instead. WRITABLE state (venv, downloaded
  // python, models) lives under mikuHome() in userData, NOT here, so a per-machine
  // install or read-only resources can't break setup.
  return isDev
    ? join(process.cwd(), 'miku-server')
    : join(process.resourcesPath, 'miku-server')
}
/** Writable Miku home in userData: holds the embedded python, .venv, and models. */
function mikuHome(): string {
  const d = join(app.getPath('userData'), 'miku')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}
function mikuModelsDir(): string {
  const d = join(mikuHome(), 'models')
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

/** Poll /v1/health until it reports ready:true (→ ready). A 200 alone is NOT
 *  enough: miku-server answers 200 with {ready:false, error} when the engine
 *  failed to load — flipping to 'ready' on that would 503 every speech request
 *  later. A reported engine error or the 90s timeout → 'error' phase so the UI
 *  can tell the user instead of waiting forever. */
function pollMikuHealth(deadline: number): void {
  if (!mikuProc) return // server stopped/exited while we were waiting
  if (Date.now() > deadline) {
    mikuLog('\n[ยังเริ่มไม่เสร็จใน 90 วินาที — ดู log ด้านบน หรือกดเริ่มใหม่]')
    mikuSetPhase('error')
    return
  }
  const retry = (): void => {
    mikuHealthTimer = setTimeout(() => pollMikuHealth(deadline), 1000)
  }
  const req = httpGet(MIKU_HEALTH_URL, (res) => {
    let body = ''
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => {
      body += chunk
    })
    res.on('end', () => {
      if (!mikuProc) return // stopMiku() was called while this request was in-flight
      if (res.statusCode !== 200) return retry()
      let health: { ready?: boolean; error?: string } = {}
      try {
        health = JSON.parse(body) as { ready?: boolean; error?: string }
      } catch {
        // non-JSON 200 — treat as not ready yet
      }
      if (health.ready === true) {
        mikuSetPhase('ready')
        return
      }
      if (health.error) {
        mikuLog(`\n[เอนจินเสียงโหลดไม่สำเร็จ: ${health.error}]`)
        mikuSetPhase('error')
        return
      }
      retry() // 200 but still warming up (ready:false, no error yet)
    })
  })
  req.on('error', retry)
  req.setTimeout(2000, () => req.destroy())
}

function startMiku(): { ok: boolean; error?: string } {
  if (mikuProc) return { ok: true }
  const dir = mikuDir()
  if (!existsSync(join(dir, 'server.py'))) return { ok: false, error: 'miku-server not found' }
  // run.bat sets up the venv + deps on first run, then launches server.py.
  // Pass the ABSOLUTE path: a bare `run.bat` relies on cmd searching the current
  // directory, which Windows can disable (NoDefaultCurrentDirectoryInExePath /
  // security policy / launch-from-Explorer), yielding "'run.bat' is not recognized".
  // run.bat does `cd /d "%~dp0"` itself, so it still operates in its own folder.
  // run.bat reads these: MIKU_HOME (writable venv/models), MIKU_TORCH (cpu|cu124),
  // and MIKU_PYTHON (the embedded interpreter, when setup downloaded one — else
  // run.bat falls back to the system py launcher).
  const env: NodeJS.ProcessEnv = { ...process.env, MIKU_HOME: mikuHome(), MIKU_TORCH: mikuTorch }
  if (mikuPythonExe) env.MIKU_PYTHON = mikuPythonExe
  mikuProc = spawn('cmd.exe', ['/c', join(dir, 'run.bat')], { cwd: dir, env, windowsHide: true })
  mikuSetPhase('starting')
  mikuProc.stdout?.on('data', (d) => mikuLog(String(d)))
  mikuProc.stderr?.on('data', (d) => mikuLog(String(d)))
  mikuProc.on('exit', (code) => {
    mikuLog(`\n[server exited: ${code}]`)
    mikuProc = null
    clearMikuHealthTimer()
    // Guard: stopMiku() already set 'stopped' — avoid duplicate status push to renderer.
    if (mikuPhase !== 'stopped') mikuSetPhase('stopped')
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

function downloadModel(url: string, filename: string): Promise<void> {
  return downloadFile(url, join(mikuModelsDir(), filename))
}

/* ── Miku preflight probes (feed the pure decide() in mikuPreflight.ts) ──────── */
// All probes are best-effort and wrapped so a failure degrades gracefully rather
// than crashing the verdict: a missing tool yields a conservative default (e.g.
// "no GPU" → warn, not fail). wmic is tried first per the plan, then PowerShell
// CIM as a fallback (wmic is deprecated/absent on Windows 11 24H2+).

/** Run a command, resolving its stdout ('' on any error/timeout). Never rejects. */
function tryExec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout))
    })
  })
}

/** Free GB on the drive that holds userData. fs.statfs throws ENOSYS on Windows,
 *  so query the logical disk via wmic (→ PowerShell CIM fallback). Conservative
 *  default when both fail: assume enough space (don't block a working machine). */
async function freeDiskGB(forPath: string): Promise<number> {
  const drive = (forPath.match(/^([A-Za-z]):/)?.[1] ?? 'C').toUpperCase()
  // wmic prints "FreeSpace\n<bytes>"; parse the first long run of digits.
  const wmic = await tryExec('wmic', ['logicaldisk', 'where', `DeviceID='${drive}:'`, 'get', 'FreeSpace'])
  let bytes = Number(wmic.match(/\d{5,}/)?.[0] ?? 0)
  if (!bytes) {
    const ps = await tryExec('powershell', [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}:'").FreeSpace`,
    ])
    bytes = Number(ps.match(/\d{5,}/)?.[0] ?? 0)
  }
  return bytes > 0 ? bytes / 1024 ** 3 : 999 // unknown → don't block
}

/** True if an NVIDIA GPU is present. Failure → false (CPU mode = warn, not crash). */
async function detectNvidia(): Promise<boolean> {
  const wmic = await tryExec('wmic', ['path', 'win32_VideoController', 'get', 'name'])
  if (/nvidia/i.test(wmic)) return true
  if (wmic) return false // wmic worked and saw no NVIDIA
  const ps = await tryExec('powershell', [
    '-NoProfile',
    '-Command',
    '(Get-CimInstance Win32_VideoController).Name',
  ])
  return /nvidia/i.test(ps)
}

/** HEAD pypi with a short timeout. Any response → online; error/timeout → offline. */
function probeOnline(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpsRequest(
      { method: 'HEAD', host: 'pypi.org', path: '/', timeout: 4000 },
      (res) => {
        res.resume()
        resolve(true)
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

async function gatherProbe(): Promise<Probe> {
  const [disk, nvidia, online] = await Promise.all([
    freeDiskGB(app.getPath('userData')),
    detectNvidia(),
    probeOnline(),
  ])
  return {
    freeDiskGB: disk,
    totalRamGB: totalmem() / 1024 ** 3,
    hasNvidia: nvidia,
    online,
    arch: process.arch,
  }
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

/**
 * HIGH-1: only ever hand https:/mailto: URLs to the OS. A renderer (or XSS in
 * model output) could otherwise pass `file://`, `javascript:`, or a custom scheme
 * to shell.openExternal and trigger local-handler execution. Used at BOTH
 * openExternal sites (setWindowOpenHandler + the `app:open-external` handler).
 */
function openSafe(raw: string): void {
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:' || u.protocol === 'mailto:') shell.openExternal(raw)
  } catch {
    /* malformed url → drop */
  }
}

/**
 * CRIT-2a: inject a Content-Security-Policy so model-rendered output can't run
 * script in the renderer (the realistic XSS vector). Strict only when packaged;
 * in dev the renderer loads from ELECTRON_RENDERER_URL and Vite HMR needs a
 * websocket + inline scripts, so connect-src/script-src are relaxed to localhost.
 * Audio (edge-tts/miku) plays as data:/blob:, covered by media-src.
 */
function installCsp(): void {
  const strict =
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; " +
    "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
  const dev =
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; " +
    "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' ws://localhost:* http://localhost:*"
  const policy = app.isPackaged ? strict : dev
  session.defaultSession.webRequest.onHeadersReceived((d, cb) => {
    cb({
      responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': [policy] },
    })
  })
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
      // sandbox:true restricts the preload to contextBridge/ipcRenderer (all our
      // preload uses), shrinking the renderer's attack surface (defense-in-depth
      // for CRIT-2a). window.claudedeck bridge is unaffected.
      sandbox: true,
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
    openSafe(url)
    return { action: 'deny' }
  })

  // Toggle DevTools with F12 (works in production build too).
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  // Register maximize listeners once here, not in browser-window-created (which fires
  // for every BrowserWindow and would stack duplicate listeners on subsequent windows).
  const emitMaxState = (): void =>
    safeSend(mainWindow, 'window:maximized-changed', mainWindow?.isMaximized())
  mainWindow.on('maximize', emitMaxState)
  mainWindow.on('unmaximize', emitMaxState)

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

  // ── Per-session attention (transient): title badge + gated OS notification ──
  ipcMain.on('app:set-attention-count', (_e, n: number) => {
    if (!mainWindow) return
    mainWindow.setTitle(typeof n === 'number' && n > 0 ? `ClaudeDeck (${n})` : 'ClaudeDeck')
  })

  ipcMain.on(
    'app:notify',
    (_e, msg: { kind: NotifyKind; name: string; sessionId: string }) => {
      // Validate the renderer payload at the trust boundary: `kind` is the only field
      // that branches behavior, and an out-of-contract value (e.g. an IndicatorKind
      // like 'unread') would silently emit a wrong toast.
      if (!msg || (msg.kind !== 'needsInput' && msg.kind !== 'done')) return
      // Only notify when the window is NOT focused; otherwise the in-app dot suffices.
      if (!mainWindow || mainWindow.isFocused()) return
      if (!Notification.isSupported()) return
      const { title, body } = notificationContent(msg.kind, msg.name || '')
      const n = new Notification({ title, body })
      n.on('click', () => {
        if (!mainWindow) return
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
        safeSend(mainWindow, 'app:focus-session', { sessionId: msg.sessionId })
      })
      n.show()
    },
  )
  // Every `handle` below goes through safeHandle: the callback can never reject
  // and never returns a non-clonable value, so no channel can produce the
  // renderer's "Error invoking remote method '…'" overlay. On failure it logs in
  // the main process and returns the per-channel fallback (same shape as the
  // success return, so preload typings stay correct).
  safeHandle(ipcMain, 'window:is-maximized', () => mainWindow?.isMaximized() ?? false, () => false)

  // App meta + external links + update check (GitHub Releases).
  safeHandle(
    ipcMain,
    'app:info',
    () => ({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
    }),
    () => ({ version: '', platform: process.platform, arch: process.arch, electron: process.versions.electron }),
  )
  safeHandle(ipcMain, 'app:open-external', (_e, url: string) => openSafe(url), () => undefined)
  safeHandle(
    ipcMain,
    'app:pick-directory',
    async (): Promise<string | null> => {
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
    },
    () => null,
  )
  safeHandle(
    ipcMain,
    'app:check-update',
    async () => {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 8000)
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
          headers: { 'user-agent': 'ClaudeDeck', accept: 'application/vnd.github+json' },
          signal: ac.signal,
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
      } finally {
        clearTimeout(t)
      }
    },
    (e) => ({ ok: false, error: errMsg(e) }),
  )

  // In-app auto-update (electron-updater). Packaged-only: in dev there's no
  // `app-update.yml`, and the zip/portable build has none either → both return
  // `{ ok:false, error:'dev' }` and the renderer falls back to the Releases link.
  safeHandle(
    ipcMain,
    'updater:check',
    async () => {
      if (!app.isPackaged) return { ok: false, error: 'dev' }
      await (await getUpdater()).checkForUpdates()
      return { ok: true }
    },
    (e) => ({ ok: false, error: errMsg(e) }),
  )
  safeHandle(
    ipcMain,
    'updater:download',
    async () => {
      if (!app.isPackaged) return { ok: false, error: 'dev' }
      await (await getUpdater()).downloadUpdate()
      return { ok: true }
    },
    (e) => ({ ok: false, error: errMsg(e) }),
  )
  safeHandle(
    ipcMain,
    'updater:install',
    async () => {
      // quitAndInstall terminates the app → this reply never reaches the renderer.
      // The renderer must treat app-exit (not a resolved promise) as success.
      // (false, true) = don't be silent, force-run the installer after quit.
      if (app.isPackaged) (await getUpdater()).quitAndInstall(false, true)
      return { ok: true }
    },
    () => ({ ok: false }),
  )

  // Free Edge-TTS (Microsoft online neural voices) — runs here in the main
  // process because Chromium renderers can't open the Edge TTS socket directly.
  // Returns '' on failure rather than throwing: the renderer's edgeSpeak treats
  // empty audio as failure and speakSmart falls back to the system voice.
  safeHandle(
    ipcMain,
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
    () => '',
  )

  // Custom OpenAI-compatible TTS server (advanced; e.g. a local RVC/VITS Miku).
  // Done in main to avoid renderer CORS against the user's local server. Returns
  // '' on failure (customSpeak/speakSmart fall back to the system voice).
  safeHandle(
    ipcMain,
    'tts:custom',
    async (
      _e,
      args: { url: string; voice: string; model: string; apiKey?: string; input: string },
    ): Promise<string> => {
      // HIGH-2: a renderer-supplied TTS endpoint must be public https — block
      // SSRF to metadata/private hosts before we fetch it. Loopback http is
      // allowed here ONLY: the default Miku server lives on http://127.0.0.1:5050.
      const bad = rejectUnsafeUrlAllowLoopback(args.url)
      if (bad) throw new Error(bad)
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
    () => '',
  )

  // Miku voice server lifecycle (start/stop the local Python server from the UI).
  safeHandle(ipcMain, 'miku:start', () => startMiku(), (e) => ({ ok: false, error: errMsg(e) }))
  safeHandle(
    ipcMain,
    'miku:stop',
    () => {
      stopMiku()
      return { ok: true }
    },
    () => ({ ok: false }),
  )
  safeHandle(ipcMain, 'miku:status', () => mikuPhase, () => 'stopped' as MikuPhase)
  safeHandle(
    ipcMain,
    'miku:has-model',
    () => {
      const files = readdirSync(mikuModelsDir(), { recursive: true }) as string[]
      return files.some((f) => String(f).toLowerCase().endsWith('.pth'))
    },
    () => false,
  )
  safeHandle(ipcMain, 'miku:open-models', () => shell.openPath(mikuModelsDir()), () => '')
  // Forward the renderer's fixed-phrase prewarm list to the server (done in main
  // to avoid renderer CORS against the local server). The server renders them in
  // the background and returns immediately, so this resolves fast; we never block
  // the UI on the actual cache warm-up.
  safeHandle(
    ipcMain,
    'miku:prewarm',
    async (_e, phrases: unknown): Promise<{ ok: boolean; count?: number; error?: string }> => {
      const list = (Array.isArray(phrases) ? phrases : [])
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      if (list.length === 0) return { ok: true, count: 0 }
      const res = await fetch(MIKU_PREWARM_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phrases: list }),
      })
      return { ok: res.ok, count: list.length }
    },
    (e) => ({ ok: false, error: errMsg(e) }),
  )
  safeHandle(
    ipcMain,
    'miku:download-model',
    async (_e, args: { url: string; index?: string }): Promise<{ ok: boolean; error?: string }> => {
      // HIGH-3: guard BOTH the model and the (separately-supplied) index URL —
      // args.index was previously unchecked. downloadFile re-validates each
      // redirect hop too.
      const badUrl = rejectUnsafeUrl(args.url)
      if (badUrl) throw new Error(badUrl)
      if (args.index) {
        const badIndex = rejectUnsafeUrl(args.index)
        if (badIndex) throw new Error(badIndex)
      }
      await downloadModel(args.url, 'miku.pth')
      if (args.index) await downloadModel(args.index, 'miku.index')
      return { ok: true }
    },
    (e) => ({ ok: false, error: errMsg(e) }),
  )
  // Spec-check the machine before offering the (large) embedded-Python setup.
  // Pure decision lives in mikuPreflight.ts; here we only gather real probes.
  safeHandle(
    ipcMain,
    'miku:preflight',
    async () => {
      lastProbe = await gatherProbe()
      return decide(lastProbe)
    },
    () => ({ ok: false, level: 'fail' as const, checks: [] }),
  )
  // Download + install the embedded Python (+ pick torch channel), then start the
  // server. The venv/pip/model/launch steps run inside run.bat — their output
  // streams to miku:log and phase flips via miku:status — so here we only own the
  // python/torch prep and report it via miku:setup-progress.
  safeHandle(
    ipcMain,
    'miku:setup',
    async (): Promise<{ ok: boolean; error?: string }> => {
      // Reuse the probe the UI just gathered via miku:preflight; only re-probe if
      // setup was somehow invoked without one.
      const verdict = decide(lastProbe ?? (await gatherProbe()))
      if (!verdict.ok) {
        const reason = verdict.checks.find((c) => c.level === 'fail')?.detail ?? 'preflight failed'
        return { ok: false, error: reason }
      }
      const emit = (p: SetupProgress): void => safeSend(mainWindow, 'miku:setup-progress', p)
      const hasNvidia = verdict.checks.find((c) => c.id === 'gpu')?.level === 'pass'
      const prep = await prepareMiku(mikuHome(), hasNvidia, emit)
      mikuTorch = prep.torch
      mikuPythonExe = prep.pythonExe
      emit({ step: 'done', percent: 100, message: 'พร้อมเริ่มเซิร์ฟเวอร์มิกุ' })
      const started = startMiku()
      return started.ok ? { ok: true } : { ok: false, error: started.error }
    },
    (e) => ({ ok: false, error: errMsg(e) }),
  )

  // ── Real claude CLI backend (Slice A) ──────────────────────────────────────
  safeHandle(ipcMain, 'claude:available', async () => (await detectClaude()) !== null, () => false)
  safeHandle(
    ipcMain,
    'claude:start',
    (_e, args) => {
      if (!mainWindow) return { ok: false, error: 'no window' }
      return startTurn(mainWindow, args)
    },
    (e) => ({ ok: false, error: errMsg(e) }),
  )
  safeHandle(
    ipcMain,
    'claude:cancel',
    (_e, turnId: string) => {
      cancelTurn(turnId)
      return { ok: true }
    },
    () => ({ ok: false }),
  )
  safeHandle(
    ipcMain,
    'claude:permission-response',
    (
      _e,
      { turnId, id, decision, input, message }:
        { turnId: string; id: string; decision: PermissionDecision; input?: unknown; message?: string },
    ) => ({ ok: respondPermission(turnId, id, decision, { input, message }) }),
    () => ({ ok: false }),
  )
  // Borderline-difficulty classifier (Task 2): a throwaway Haiku turn. classifyTurn
  // never rejects (falls back to restingTier internally), so this resolves quickly.
  safeHandle(
    ipcMain,
    'model:classify',
    (_e, { prompt, restingTier }: { prompt: string; restingTier: Tier }) =>
      classifyTurn(prompt, restingTier),
    () => 'opus' as Tier,
  )

  // ── Auth (login/logout/status) ─────────────────────────────────────────────
  safeHandle(ipcMain, 'auth:status', () => getAuthStatus(), () => ({ loggedIn: false }))
  safeHandle(
    ipcMain,
    'auth:login-start',
    () => {
      if (!mainWindow) return { ok: false, error: 'no window' }
      return startLogin(mainWindow)
    },
    (e) => ({ ok: false, error: errMsg(e) }),
  )
  safeHandle(
    ipcMain,
    'auth:login-code',
    (_e, code: string) => submitLoginCode(code),
    (e) => ({ ok: false, error: errMsg(e) }),
  )
  safeHandle(
    ipcMain,
    'auth:login-cancel',
    () => {
      cancelLogin()
      return { ok: true }
    },
    () => ({ ok: false }),
  )
  safeHandle(ipcMain, 'auth:logout', () => logout(), (e) => ({ ok: false, error: errMsg(e) }))

  // ── git (footer pickers) ──────────────────────────────────────────────────
  safeHandle(
    ipcMain,
    'git:status',
    (_e, cwd: string) => gitStatus(cwd),
    () => ({ isRepo: false, branch: '', isWorktree: false, isDirty: false }),
  )
  safeHandle(ipcMain, 'git:branches', (_e, cwd: string) => gitBranches(cwd), () => [])
  safeHandle(
    ipcMain,
    'git:checkout',
    (_e, args: { cwd: string; branch: string }) => gitCheckout(args.cwd, args.branch),
    (e) => ({ ok: false, error: errMsg(e) }),
  )
  safeHandle(ipcMain, 'git:worktrees', (_e, cwd: string) => gitWorktrees(cwd), () => [])
  safeHandle(
    ipcMain,
    'git:worktree-add',
    (_e, args: { cwd: string; path: string; branch: string; newBranch?: boolean }) =>
      gitWorktreeAdd(args.cwd, args.path, args.branch, args.newBranch),
    (e) => ({ ok: false, error: errMsg(e) }),
  )
  safeHandle(
    ipcMain,
    'git:fork-worktree',
    (_e, args: { cwd: string; branch: string }) => gitForkWorktree(args.cwd, args.branch),
    (e) => ({ ok: false, error: errMsg(e) }),
  )

  // ── sessions (hybrid persistence: our index + claude JSONL transcripts) ────
  safeHandle(ipcMain, 'sessions:load', () => loadIndex(), () => [])
  safeHandle(
    ipcMain,
    'sessions:save',
    (_e, sessions: StoredSession[]) => { saveIndex(sessions); return { ok: true } },
    () => ({ ok: false }),
  )
  safeHandle(ipcMain, 'sessions:transcript', (_e, uuid: string) => readTranscript(uuid), () => null)

  // ── settings (disk-backed, origin-independent: survives Vite dev-port drift) ──
  // On a genuine first run loadSettings() returns null; only a real read failure
  // hits the fallback. Signal that distinctly ({ __error: true }) so the renderer
  // won't mistake a transient failure for first-run and overwrite the intact file (#4).
  safeHandle(ipcMain, 'settings:load', () => loadSettings(), () => ({ __error: true }))
  safeHandle(
    ipcMain,
    'settings:save',
    (_e, s: Record<string, unknown>) => { saveSettings(s); return { ok: true } },
    () => ({ ok: false }),
  )
}

app.whenReady().then(() => {
  installCsp() // before any window loads — CRIT-2a
  registerIpc()
  // Inject ClaudeDeck's spawn_task MCP tool into every inner-CLI turn (best-effort;
  // the writer swallows errors and returns undefined, leaving turns unaffected).
  setSpawnTaskMcpConfig(
    writeSpawnTaskMcpConfig(
      app.getPath('userData'),
      join(__dirname, 'spawnTaskServer.js'),
      process.execPath,
    ),
  )
  createSplash()
  createMainWindow()

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
  // before-quit already handles cleanup (cancelAllTurns / cancelLogin / stopMiku).
  if (process.platform !== 'darwin') app.quit()
})
