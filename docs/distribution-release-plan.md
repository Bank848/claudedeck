# ClaudeDeck — Distribution & Release Readiness Plan

> Single-file lean plan (plan-pro, token-saving md). Branch from `main`.
> Repo: `Bank848/claudedeck` · Electron + React + TS + electron-vite + electron-builder (NSIS).
> Status of design: **approved in chat.** Code-sign = not signing now, but wire the hooks.

---

## Goal

Make ClaudeDeck installable & maintainable by ordinary end-users:

1. **CI release** — push a `v*` tag → GitHub Actions builds the NSIS installer and publishes it to GitHub Releases.
2. **Auto-update** — replace the manual "check link" with `electron-updater` (download + install in-app), feeding off GitHub Releases.
3. **Miku TTS hybrid + preflight** — app speaks immediately via edge-tts (no Python); a Settings button runs a **preflight spec-check** then **auto-sets-up** an embedded Python + RVC so the user never touches a terminal.
4. **Code-sign hooks** — leave CI env/secret seams so a cert can be slotted in later with zero rework.

### Key decisions / tradeoffs (plain language)

- **Embedded Python = `python-build-standalone`** (astral-sh), *not* python.org "embeddable zip". The embeddable zip can't run `venv`/`pip` reliably; the standalone build is a full portable CPython (~25 MB) that supports venv + pip out of the box. Downloaded on-demand to a **writable** dir (`userData`), only when the user opts into Miku.
  - **Extraction:** the `install_only` artifact is a **`.tar.gz`** — Node has no built-in tar. Add the **`tar`** npm dep (runtime) to extract; do **not** assume `7z`/`tar.exe` on the user's machine.
- **Writable state moves to `userData`.** Today `run.bat` writes `.venv` + `models\` into the bundled `miku-server` (works only because NSIS `perMachine:false` lands in `%LOCALAPPDATA%`). We make it explicit + robust by pointing venv/python/models at `app.getPath('userData')` via an env var, so a per-machine install (or read-only resources) can't break it.
- **torch CPU vs CUDA chosen by preflight.** NVIDIA GPU detected → `cu124` wheel (fast); else → `cpu` wheel (works everywhere, slower). Removes the hard-coded `cu124` in `run.bat` that breaks on non-NVIDIA machines.
- **Auto-update is unsigned for now.** electron-updater works unsigned on Windows (NSIS); the SmartScreen prompt remains until a cert is added. CI is structured so adding `CSC_LINK`/`CSC_KEY_PASSWORD` secrets later "just works".
- **Hybrid fallback is already half-built**: `tts:edge` + `speakSmart()` exist. We only add the preflight gate + embedded-python bootstrap + setup-progress UI.

---

## Before / After

### Distribution flow

```
BEFORE                                   AFTER
------                                   -----
dev runs `npm run dist` by hand          git tag v0.2.0 && push
   → release/0.1.0/*.exe (local only)        → GH Actions: build + publish
manual: upload exe to Releases             → Release asset: ClaudeDeck-Setup-0.2.0.exe
user: clicks "check update" → opens URL    → app auto-downloads + installs update
user: must install Python+torch by hand    → preflight gate → app installs python+torch itself
```

### Miku enablement

```
BEFORE                                          AFTER
------                                          -----
Settings: "Start Miku"                          Settings: "เปิดเสียง Miku (RVC)"
  → run.bat                                       → miku:preflight  (disk/ram/gpu/net/arch)
     → needs system `py` launcher                    ├─ FAIL → blocked + reason, stay on edge-tts
     → pip install torch cu124 (NVIDIA only)          └─ PASS/WARN → miku:setup
     → user must drop .pth in models\ first              → download python-build-standalone → userData
  → connection refused if no Python                     → venv + pip (cpu|cu124 per GPU)
                                                        → download RVC .pth/.index
                                                        → server.py ; meanwhile edge-tts speaks
                                                     progress + aria-live throughout
```

---

## What's changing

**Added**
- `.github/workflows/release.yml` — tag-triggered build + publish (code-sign env seams commented).
- `electron/mikuPreflight.ts` — pure spec-check (disk/ram/gpu/net/arch) → `{ ok, level, checks[] }`.
- `electron/mikuPreflight.test.ts` — unit tests for the pass/warn/fail decision (pure fn).
- `electron/mikuSetup.ts` — embedded-python bootstrap orchestration (download standalone CPython → venv → pip → model), emits progress events.
- `src/renderer/settings/mikuPreflight.ts` — renderer hook for preflight + setup state (aria-live messages).
- `src/renderer/settings/mikuPreflight.test.ts` — formatting/decision tests.

**Modified**
- `package.json` — add `electron-updater`; add electron-builder `publish` (github) + `nsis` already ok; `extraResources` keep source only.
- `electron/main.ts` — add `electron-updater` wiring; `miku:preflight` + `miku:setup` IPC; redirect venv/python/models to `userData`; spawn setup before server.
- `electron/preload.ts` — expose `miku.preflight`, `miku.setup`, `onSetupProgress`; `updater.*` (check/download/install + events).
- `miku-server/run.bat` — bootstrap embedded Python when no system `py`; pick cpu|cu124 torch from `MIKU_TORCH` env; read base dir from `MIKU_HOME` env.
- `src/renderer/settings/mikuServer.ts` — consume preflight gate before `start()`.
- `src/renderer/views/settings/SettingsView.tsx` — preflight/setup UI (radiogroup-consistent, aria-live progress).

**Removed**
- Hard-coded `cu124` assumption in `run.bat` (replaced by env-driven choice).

---

## Architecture notes

- **No new runtime deps in renderer.** electron-updater is main-process only.
- **electron-updater + dev:** `autoUpdater` can throw at *import time* (no `app-update.yml`) in v6 → **lazy-import** `electron-updater` *inside* the handlers (`const { autoUpdater } = await import('electron-updater')`), not at top of file, and guard every handler with `if (!app.isPackaged) return`. Top-level import = dev startup crash risk.
- **`quitAndInstall` semantics:** it terminates the app, so the `updater:install` IPC reply never arrives — the renderer must treat *app restart* as success, not the promise resolving. Call `autoUpdater.quitAndInstall(false, true)`.
- **NSIS auto-update caveat:** `allowToChangeInstallationDirectory:true` + `perMachine:false` can break in-place updates if the user moved the install dir (updater reads the original registry path). Keep it, but `docs/SIGNING.md`/release notes should mention "if you changed the install folder, a moved update may need a manual reinstall."
- **Preflight is a pure module** (takes injected probes, returns a verdict) so it's unit-testable without touching real disk/GPU — TDD-friendly per repo convention.
- **Setup is idempotent + resumable:** each step checks "already done" (python exists? venv exists? torch importable? model present?) before doing work, so a retry after a failed download doesn't redo gigabytes.

---

## Tech stack additions

- `electron-updater` `^6` (runtime dep)
- GitHub Actions: `actions/checkout@v4`, `actions/setup-node@v4`, build on `windows-latest`
- `python-build-standalone` release asset (CPython 3.11, `*-x86_64-pc-windows-msvc-install_only.tar.gz`)

---

# Implementation Plan (TDD, bite-sized)

## Chunk 1 — GitHub Actions release + publish config

### Task 1.1 — electron-builder publish config
`package.json` `build` block — add `publish` and keep NSIS as-is.

- [ ] Add to `build`:
```jsonc
"publish": [
  { "provider": "github", "owner": "Bank848", "repo": "claudedeck" }
],
```
- [ ] Set `build.win.target` to `["nsis", "zip"]` — `nsis` = installer (auto-updatable), `zip` = portable build for users who dislike installers (unzip → run `ClaudeDeck.exe`, no install). Keep `artifactName` for nsis; the zip gets electron-builder's default name `${productName}-${version}-win.zip`. Leave `channel` unset (default `latest`) so clients read `latest.yml`.
  - **Caveat to document:** the **zip/portable build does NOT auto-update** — only the `nsis` install path feeds electron-updater. The zip's update-check should show "download the latest zip manually" instead of the in-app updater. Detect via `app.isPackaged && process.env.PORTABLE_EXECUTABLE_DIR` is unset for zip; simplest: gate the updater UI on a build-time flag or just let `updater:check` return gracefully (zip has no `app-update.yml` → handler already returns an error, UI falls back to the GitHub Releases link).
  - **Mac = Phase 2 (deferred):** add `mac: { target: ['dmg','zip'] }` + a `macos-latest` CI matrix leg later. Skipped now because unsigned mac apps hit Gatekeeper ("app is damaged") — bad UX without an Apple Developer cert + notarization ($99/yr). Not in this plan's scope.
- [ ] electron-updater needs **two** artifacts that electron-builder emits only when `publish` is set: `latest.yml` (release asset) **and** `app-update.yml` (embedded in the asar). Verify BOTH after first build, not just the release asset.
- [ ] Optional but recommended for this app (bundles miku-server source → big installer): set `nsis.differentialPackage: true` so updates download a diff, not the full `.exe`.

### Task 1.2 — release workflow
Create `.github/workflows/release.yml`:

- [ ] Trigger on `push: tags: ['v*']`.
- [ ] `windows-latest`, Node 20, `npm ci`, `npm run build`, then `npx electron-builder --win --publish always`.
- [ ] Pass `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` for publishing.
- [ ] **Code-sign seam (commented):** include the env block but commented, so adding repo secrets later is the only change:
```yaml
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npx electron-builder --win --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # ── Code-sign (enable later — no rework needed) ──
          # CSC_LINK: ${{ secrets.CSC_LINK }}            # base64 .pfx
          # CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          # ── or Azure Trusted Signing: add azure-trusted-signing step here ──
```
- [ ] Verify: `git tag v0.1.1 && git push origin v0.1.1` → Actions builds → Release has `ClaudeDeck-Setup-0.1.1.exe` + `latest.yml`.

---

## Chunk 2 — electron-updater (in-app auto-update)

### Task 2.1 — dependency
- [ ] `npm i electron-updater@^6`.

### Task 2.2 — main-process wiring (`electron/main.ts`)
- [ ] **Lazy-import** electron-updater (NOT a top-level import — dev crash risk). Init once, packaged-only:
```ts
let updaterReady = false
async function getUpdater() {
  const { autoUpdater } = await import('electron-updater')
  if (!updaterReady) {
    updaterReady = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true   // also installs silently on normal quit
    autoUpdater.on('update-available', (i) => safeSend(mainWindow, 'updater:available', { version: i.version }))
    autoUpdater.on('update-not-available', () => safeSend(mainWindow, 'updater:none', {}))
    autoUpdater.on('download-progress', (p) => safeSend(mainWindow, 'updater:progress', { percent: p.percent }))
    autoUpdater.on('update-downloaded', () => safeSend(mainWindow, 'updater:downloaded', {}))
    autoUpdater.on('error', (e) => safeSend(mainWindow, 'updater:error', { error: errMsg(e) }))
  }
  return autoUpdater
}
safeHandle(ipcMain, 'updater:check', async () => {
  if (!app.isPackaged) return { ok: false, error: 'dev' }
  await (await getUpdater()).checkForUpdates(); return { ok: true }
}, (e) => ({ ok: false, error: errMsg(e) }))
safeHandle(ipcMain, 'updater:download', async () => {
  if (!app.isPackaged) return { ok: false, error: 'dev' }
  await (await getUpdater()).downloadUpdate(); return { ok: true }
}, (e) => ({ ok: false, error: errMsg(e) }))
safeHandle(ipcMain, 'updater:install', async () => {
  // quitAndInstall terminates the app → this reply never reaches the renderer.
  // The renderer must treat app-exit as success, not a resolved promise.
  if (app.isPackaged) (await getUpdater()).quitAndInstall(false, true)
  return { ok: true }
}, () => ({ ok: false }))
```
- [ ] Keep the existing `app:check-update` (lightweight banner). **Decide one owner for the Settings "check" button** — post-Chunk-2 the button calls `updater.check()`; `app:check-update` stays only for a passive startup banner. Don't wire both to the same control.

### Task 2.3 — preload surface (`electron/preload.ts`)
- [ ] Add under `api`:
```ts
updater: {
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  install: () => ipcRenderer.invoke('updater:install'),
  onAvailable: (cb:(v:{version:string})=>void) => sub('updater:available', cb),
  onProgress: (cb:(p:{percent:number})=>void) => sub('updater:progress', cb),
  onDownloaded: (cb:()=>void) => sub('updater:downloaded', cb),
  onError: (cb:(e:{error:string})=>void) => sub('updater:error', cb),
},
```
(factor the repeated `ipcRenderer.on/removeListener` into a local `sub()` helper.)
- [ ] **Also add the Miku setup surfaces here** (used by Task 3.4, easy to forget): extend the existing `miku` object with `preflight: () => ipcRenderer.invoke('miku:preflight')`, `setup: () => ipcRenderer.invoke('miku:setup')`, and `onSetupProgress: (cb) => sub('miku:setup-progress', cb)`.

### Task 2.4 — renderer UI
- [ ] In Settings (or a header banner), wire: check → show version → download (progress bar, aria-live %) → "Restart & install" button → `install()`.
- [ ] a11y: progress announced via `aria-live="polite"`; the restart action is a real `<button>`.

---

## Chunk 3 — Miku hybrid + preflight + embedded Python

### Task 3.1 — preflight module (pure, TDD first)
`electron/mikuPreflight.ts`:
- [ ] Type: `type Check = { id:'disk'|'ram'|'gpu'|'net'|'arch'; level:'pass'|'warn'|'fail'; detail:string }`.
- [ ] Pure `decide(probe: Probe): { ok:boolean; level:'pass'|'warn'|'fail'; checks: Check[] }` where `Probe = { freeDiskGB:number; totalRamGB:number; hasNvidia:boolean; online:boolean; arch:string }`.
- [ ] Rules: disk `<3GB`→fail; ram `<4GB`→fail, `<8GB`→warn; arch `!== 'x64'`→fail; net offline→fail; `hasNvidia=false`→warn ("CPU mode, slower"). `ok = no fail`.
- [ ] **Write `mikuPreflight.test.ts` first** (RED): disk-too-small→fail; 6GB ram→warn; no-gpu→warn-but-ok; arm→fail.

### Task 3.2 — real probes + IPC (`electron/main.ts`)
- [ ] `gatherProbe()`:
  - `freeDiskGB` — **`fs.statfs` is NOT on Windows (throws ENOSYS).** Use the drive of `userData`: `wmic logicaldisk where "DeviceID='C:'" get FreeSpace` (or PowerShell `Get-PSDrive`), parse bytes → GB. Pick the drive letter from `app.getPath('userData')`.
  - `totalRamGB` via `os.totalmem()`.
  - `hasNvidia` via `wmic path win32_VideoController get name` (match /nvidia/i) or `nvidia-smi -L`.
  - `online` via a HEAD to pypi/github with a short timeout.
  - `arch = process.arch`.
  - Each probe wrapped in try/catch → conservative default (e.g. wmic fails → assume no GPU = warn, not crash).
- [ ] `safeHandle(ipcMain, 'miku:preflight', async () => decide(await gatherProbe()), () => ({ ok:false, level:'fail', checks:[] }))`.

### Task 3.3 — embedded-python bootstrap (`electron/mikuSetup.ts` + `run.bat`)
- [ ] Add runtime dep: **`npm i tar`** (extract the `.tar.gz`; Node has no built-in tar).
- [ ] Define `mikuHome()` = `join(app.getPath('userData'), 'miku')` (writable). Models/venv/python live here.
- [ ] **Redirect ALL writable Miku paths to `mikuHome()` — coordinated change in `main.ts`:**
  - `mikuModelsDir()` → `join(mikuHome(), 'models')` (was `join(mikuDir(), 'models')`).
  - The `miku:has-model`, `miku:open-models`, `miku:download-model` handlers all call `mikuModelsDir()` → they automatically follow once the helper changes (verify each).
  - `mikuDir()` (the read-only source: `server.py`, `rvc/`, `run.bat`) stays at `resourcesPath` — only writable state moves.
- [ ] `miku:setup` IPC orchestrates, emitting `miku:setup-progress { step, percent, message }`:
  1. **python** — if no system `py` and no `mikuHome/python`, download `python-build-standalone` CPython 3.11 win x64 `install_only` **`.tar.gz`** → extract with `tar` → `mikuHome/python`.
  2. **torch** — choose `MIKU_TORCH=cu124|cpu` from preflight `hasNvidia`.
  3. delegate the venv+pip+model steps to `run.bat`, invoked with env `MIKU_HOME`, `MIKU_PYTHON` (path to bootstrapped python exe, or empty), `MIKU_TORCH`.
- [ ] **`run.bat` changes (careful with paths):**
  - read `%MIKU_HOME%` (fallback `%~dp0`); create/activate the venv at the **absolute** path: `call "%MIKU_HOME%\.venv\Scripts\activate"` (NOT the hardcoded relative `.venv` — that bug would silently use bare `python`).
  - venv creation: `"%MIKU_PYTHON%" -m venv "%MIKU_HOME%\.venv"` when `%MIKU_PYTHON%` is set, else fall back to the existing `py`-launcher detection.
  - `%MIKU_TORCH%` (default `cpu`) selects the torch index-url (`cpu`→`/whl/cpu`, `cu124`→`/whl/cu124`) — replaces the hardcoded `cu124`.
  - keep the "no .pth found" guard but scan `%MIKU_HOME%\models`.
  - final launch uses the venv python (post-activate `python server.py` is fine once activate points at `%MIKU_HOME%\.venv`).
- [ ] `startMiku()` passes the same env (`MIKU_HOME`, `MIKU_TORCH`).
- [ ] Idempotency: each step early-returns if its artifact already exists (python dir? venv? `torch` importable? `.pth` present?) — a retry after a failed download never redoes GBs.

### Task 3.4 — renderer gate + setup UI
- [ ] `src/renderer/settings/mikuPreflight.ts` hook: `runPreflight()` → verdict; `runSetup()` subscribes to progress; exposes `level`, `checks`, `step`, `percent`, `message`, `blocked`.
- [ ] `src/renderer/settings/mikuServer.ts`: before `start()`, require a passing (or warn-accepted) preflight; expose that requirement.
- [ ] `SettingsView.tsx`: "เปิดเสียง Miku (RVC)" button → preflight → show checks (pass/warn/fail with reasons) → if ok, setup with **progress bar + `aria-live="polite"`** status; FAIL shows reason + keeps edge-tts. Match existing radiogroup/preview-on-select a11y pattern.
- [ ] During setup, voice keeps working via edge-tts + `speakSmart()` (no change — just don't switch engine until `phase==='ready'`).

### Task 3.5 — packaging
- [ ] `extraResources` unchanged (source only — python/venv/models are runtime-downloaded to `userData`, never bundled).
- [ ] Verify `.venv` is **not** shipped (filter already excludes it; double-check `release/` build contains only `server.py`, `rvc/`, `requirements.txt`, `run.bat`, `rvc_infer.py`, `README.md`).

---

## Chunk 4 — Code-sign readiness (no cert yet)

### Task 4.1 — seams only
- [ ] CI env block already commented in `release.yml` (Task 1.2).
- [ ] Add a short `docs/SIGNING.md`: two paths — (a) OV/EV `.pfx` → set `CSC_LINK` (base64) + `CSC_KEY_PASSWORD` repo secrets; (b) Azure Trusted Signing → add the `azure/trusted-signing-action` step + `AZURE_*` secrets. No code change needed in either case.
- [ ] Confirm `nsis` block stays `oneClick:false` (gives the wizard; signing is orthogonal).

---

## Parallelization Analysis

Dependency view (files touched):

- **Chunk 1** (`package.json` build.publish, `.github/workflows/release.yml`) — touches `package.json`.
- **Chunk 2** (`package.json` deps, `main.ts`, `preload.ts`, renderer UI) — touches `package.json`, `main.ts`, `preload.ts`.
- **Chunk 3** (`main.ts`, `preload.ts`, `run.bat`, new `electron/miku*.ts`, renderer settings) — touches `main.ts`, `preload.ts`.
- **Chunk 4** (`release.yml`, new `docs/SIGNING.md`) — touches `release.yml`.

Shared-file conflicts: **Chunks 2 & 3 both edit `main.ts` + `preload.ts`** → must be **sequential** (or same worktree). **Chunks 1 & 4 both edit `release.yml`/`package.json`** → fold Chunk 4's CI seam into Chunk 1 (already done) so they're one unit.

Batches:
- **Batch A (parallel-safe):** Task 3.1 (`mikuPreflight.ts` + test — brand-new files, no overlap) ‖ Task 1.1+1.2+4 (CI/package.json publish + SIGNING.md).
- **Batch B (sequential, shared `main.ts`/`preload.ts`):** Chunk 2 → Chunk 3 (rest). Do updater first (smaller), then Miku.
- **Batch C (after B):** renderer UI for both (Task 2.4, 3.4) — can be parallel (different components) but both light; do inline.

Critical path: **Chunk 2 → Chunk 3.2/3.3 → 3.4** (the `main.ts`/`preload.ts` serial chain). Chunk 1+4 and Task 3.1 fall off the critical path.

---

## Verification

- [ ] `npm test` green (new preflight tests included).
- [ ] `npm run build` + `npx electron-builder --dir` produces a runnable app; `extraResources` correct.
- [ ] Tag push produces a Release with installer + `latest.yml`.
- [ ] Fresh VM (no Python, no NVIDIA): app opens, edge-tts speaks; "เปิดเสียง Miku" → preflight WARN (CPU) → setup downloads python+cpu-torch+model → Miku speaks. Disk-starved VM → preflight FAIL, blocked, edge-tts continues.
- [ ] Installed build: trigger updater check against a newer Release → download progress → restart installs.
