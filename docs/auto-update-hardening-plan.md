# Auto-Update Hardening Plan (pre-release audit)

> Audit date: 2026-07-02 · App version at audit: `0.2.0-beta.1` · Auditor: Fable 5 (check+plan only, no code changed).
> Executor: implement tasks in order (C → H → M). Each task lists exact files/lines, the reason, and the change.
> This plan **extends** `docs/distribution-release-plan.md` (Chunk 1–2 are already implemented and match that plan) — nothing here contradicts it.

---

## Current flow (verified from code, not guessed)

Two **independent** update paths exist:

1. **REST path** — `app:check-update` handler ([electron/main.ts:550-577](../electron/main.ts)) fetches `https://api.github.com/repos/Bank848/claudedeck/releases/latest`, compares with local `isNewer()` ([electron/main.ts:29-38](../electron/main.ts)). Consumed by:
   - `UpdateBanner.tsx` — runs once on app mount; its "ดาวน์โหลด" button **opens the Releases page in the browser** ([src/renderer/components/UpdateBanner.tsx:37-43](../src/renderer/components/UpdateBanner.tsx)).
   - The Settings updater hook's dev/zip fallback (`restFallback`, [src/renderer/settings/updater.ts:42-53](../src/renderer/settings/updater.ts)).
2. **electron-updater path** — lazy-init in `getUpdater()` ([electron/main.ts:52-70](../electron/main.ts)) with `autoDownload=false`, `autoInstallOnAppQuit=true`; IPC handlers `updater:check/download/install` ([electron/main.ts:582-613](../electron/main.ts)); renderer hook `useUpdater` ([src/renderer/settings/updater.ts](../src/renderer/settings/updater.ts)); UI only in Settings → About ([src/renderer/views/settings/SettingsView.tsx:813-858](../src/renderer/views/settings/SettingsView.tsx)). Triggered **only** by the manual "เช็กอัปเดต" button — never automatically.

CI: `.github/workflows/release.yml` — tag `v*` → `npm ci && npm test && npm run build && electron-builder --win --publish always`. Publish config in `package.json` (`build.publish` github Bank848/claudedeck) matches the workflow repo. Code signing intentionally disabled (commented seams, per distribution plan — SmartScreen warning is a **known accepted tradeoff**, not a bug).

---

## Findings summary

| # | Severity | Finding |
|---|----------|---------|
| C1 | **CRITICAL — blocks release** | `0.2.0-beta.1` can leak into the stable channel: nothing marks the GitHub Release as *pre-release*, and no CI guard checks tag == package.json version |
| C2 | **CRITICAL — blocks release** | `isNewer()` mis-compares pre-release versions → beta users will **never** be told stable `0.2.0` exists (banner + zip path) |
| C3 | **CRITICAL — blocks release** | No verification that `latest.yml` + `app-update.yml` actually ship; the whole in-app update path has never been proven end-to-end |
| H1 | HIGH | Startup banner sends NSIS-installed users to the browser to hand-download the full installer (loses differential update, extra SmartScreen hit) instead of the in-app updater |
| H2 | HIGH | Error UX: every failure reads "เช็กไม่ได้: <raw error>" even for download failures; raw `HTTP 403/404` shown to users; `checking` phase can get stuck forever |
| H3 | HIGH | "รีสตาร์ทแล้วติดตั้ง" runs the **full NSIS wizard** every update (`quitAndInstall(false, true)`), while quit-to-install is silent — inconsistent and clunky |
| M1 | MED | CI runs tests but not `typecheck`; no artifact assertions |
| M2 | MED | No rollback / staged-rollout runbook |
| M3 | LOW | Minor state polish: re-check while `downloaded`, no periodic re-check |

**Answers to the specific audit questions** are collected at the bottom (§Q&A) — some concerns turned out to be *fine as designed*; do not "fix" those.

---

## CRITICAL (do these before tagging the release)

### C1 — Pre-release channel containment + tag/version guard

**Why:** electron-updater's `allowPrerelease` defaults to true **only** when the running app's version has a pre-release suffix. Stable users (future `0.2.0`+) must never be offered `-beta.*` builds. That containment depends entirely on the GitHub Release being **flagged "pre-release"** — nothing in the repo enforces it today. Separately, electron-builder names the Release after `package.json` version, not the git tag: tagging `v0.2.0` while package.json says `0.2.0-beta.1` silently produces a mismatched release.

**Changes (all in `.github/workflows/release.yml`):**

1. Add a guard step right after checkout — fail the build if the tag doesn't match package.json:
   ```yaml
   - name: Verify tag matches package.json version
     shell: pwsh
     run: |
       $v = (Get-Content package.json | ConvertFrom-Json).version
       if ("v$v" -ne "${{ github.ref_name }}") {
         Write-Error "Tag ${{ github.ref_name }} != package.json v$v"; exit 1
       }
   ```
2. Auto-flag pre-releases: before the electron-builder step, set `EP_PRE_RELEASE=true` when the tag contains `-` (e.g. `v0.2.0-beta.1`). electron-builder's GitHub publisher reads the `EP_PRE_RELEASE` env var. **Verify this env var against the installed electron-builder@24 docs during implementation**; if unsupported, fall back to a release-runbook rule ("tick *Set as a pre-release* before publishing the draft") in M2's runbook.
   ```yaml
   - name: Mark pre-release builds
     if: contains(github.ref_name, '-')
     shell: pwsh
     run: echo "EP_PRE_RELEASE=true" >> $env:GITHUB_ENV
   ```
3. Note (no change needed): electron-builder's default `releaseType` is **draft** — a human publishes the draft. Keep that; it is the manual safety gate. Document the publish checklist in M2.

### C2 — Fix pre-release comparison in `isNewer()`

**Why:** [electron/main.ts:29-38](../electron/main.ts) splits on `.` and `parseInt`s each part. `"0.2.0-beta.1"` → `[0,2,0,1]` (the `-beta` is swallowed by `parseInt("0-beta")=0`), while `"0.2.0"` → `[0,2,0]`. So `isNewer("0.2.0", "0.2.0-beta.1")` = **false**: users on this very beta will never see the stable-release banner, and the zip/dev fallback in Settings will report "เป็นเวอร์ชันล่าสุดแล้ว ✓". (electron-updater's own path is unaffected — it uses real semver — which is why this only breaks the REST path.)

**Changes:**

1. Create `electron/version.ts` — a pure module (repo convention: pure fn + colocated test, see `mikuPreflight.ts`) exporting `isNewer(a, b)` with semver-precedence rules, no new dependency:
   - Split each version into numeric core (`x.y.z`) and optional pre-release suffix (after the first `-`).
   - Compare cores numerically, longest-length padded with 0.
   - Equal cores: no-suffix **beats** suffix (`0.2.0 > 0.2.0-beta.1`); two suffixes compare per dot-separated identifier (numeric identifiers numerically, alphanumeric lexically, numeric < alphanumeric, shorter list < longer when equal prefix — plain semver §11).
2. Create `electron/version.test.ts` (TDD — write first). Minimum cases:
   - `isNewer('0.2.0', '0.2.0-beta.1') === true` ← the live bug
   - `isNewer('0.2.0-beta.1', '0.2.0') === false`
   - `isNewer('0.2.0-beta.2', '0.2.0-beta.1') === true`
   - `isNewer('0.2.0-beta.1', '0.2.0-alpha.2') === true`
   - `isNewer('0.10.0', '0.9.9') === true`, `isNewer('1.0.0', '1.0.0') === false`
3. In `electron/main.ts`: delete the inline `isNewer` (lines 29-38) and `import { isNewer } from './version'`.

### C3 — Prove the update pipeline end-to-end before announcing

**Why:** electron-updater needs **two** generated artifacts: `latest.yml` (release asset) and `app-update.yml` (inside the packaged app's resources). Both only appear because `build.publish` is set. If either is missing, `updater:check` errors on every user's machine. This has never been verified on a real release (distribution plan Task 1.1 flagged it; still unchecked).

**Changes:**

1. `.github/workflows/release.yml` — add an assertion step after electron-builder:
   ```yaml
   - name: Assert update artifacts exist
     shell: pwsh
     run: |
       $v = (Get-Content package.json | ConvertFrom-Json).version
       if (-not (Test-Path "release/$v/latest.yml")) { Write-Error 'latest.yml missing'; exit 1 }
       if (-not (Get-ChildItem "release/$v" -Filter '*.blockmap')) { Write-Error 'blockmap missing (differential updates dead)'; exit 1 }
       if (-not (Test-Path "release/$v/win-unpacked/resources/app-update.yml")) { Write-Error 'app-update.yml missing'; exit 1 }
   ```
2. Manual gate (one-time, before the public announcement — add to M2 runbook): install the **previous** NSIS build in a VM, publish the new release (as pre-release), click เช็กอัปเดต → ดาวน์โหลด → รีสตาร์ทแล้วติดตั้ง, confirm the app relaunches at the new version. This is the only way to catch signing/path/registry issues the assertions can't.

---

## HIGH (should fix before release; not strictly blocking)

### H1 — Route the startup banner into the in-app updater

**Why:** [UpdateBanner.tsx:37-43](../src/renderer/components/UpdateBanner.tsx) always `openExternal(url)` → an NSIS-installed user is told to hand-download `ClaudeDeck-Setup-x.y.z.exe` from the browser (full ~download + SmartScreen prompt), even though the app can differential-update itself. The in-app flow is buried in Settings and only fires manually.

**Change (minimal, keeps one owner per control as the distribution plan requires):**

- In `UpdateBanner.tsx`, when the updater bridge is live (`window.claudedeck?.updater` exists), change the button to navigate the user to Settings → About (where the real updater UI lives) instead of `openExternal`. Look at how `App.tsx` switches views (the banner is rendered above the view switcher) and pass a `onGoToSettings` callback or reuse the existing navigation state; **do not** duplicate download/progress UI inside the banner.
- Keep `openExternal` as the fallback when the bridge is absent (browser preview) — and note the zip build *does* have the bridge but its `updater.check()` returns `{ok:false,error:'dev'}`; simplest acceptable behavior: banner still routes to Settings, whose existing fallback opens the Releases page. One code path, no new logic.

### H2 — Error handling & stuck states in `useUpdater`

**Why:** three concrete gaps in [src/renderer/settings/updater.ts](../src/renderer/settings/updater.ts):

1. **Wrong prefix:** `statusText` renders every error as `เช็กไม่ได้: <error>` (line 137) — including *download* failures (from `download()` line 108-117 or the `onError` event line 77-80). A mid-download network drop reads as "can't check". 
2. **Raw errors:** offline → raw Node error text; GitHub anonymous rate-limit → `HTTP 403`; repo with no releases → `HTTP 404` (from [electron/main.ts:561](../electron/main.ts)). Users can't act on any of those.
3. **Stuck `checking`:** `check()` (lines 93-106) sets phase `checking` and waits for an `available`/`none` push event. `safeSend` drops events if `mainWindow` is gone/recreating → the เช็กอัปเดต button stays disabled forever.

**Changes (all renderer-side; keep main.ts wire format as-is):**

1. Track the failing operation: add `op: 'check' | 'download'` state set in `check()`/`download()`; `onError` uses the current op. Error text: check → `เช็กอัปเดตไม่สำเร็จ — <friendly>`, download → `ดาวน์โหลดอัปเดตไม่สำเร็จ — ลองใหม่อีกครั้ง`.
2. Add a small `friendlyError(raw: string): string` mapper (pure, colocated test per repo convention): `/ENOTFOUND|ETIMEDOUT|EAI_AGAIN|net::ERR/i` → `ออฟไลน์หรือเชื่อมต่อ GitHub ไม่ได้`; `/HTTP 403|rate limit/i` → `GitHub จำกัดจำนวนครั้ง — ลองใหม่ภายหลัง`; `/HTTP 404/` → `ยังไม่มีเวอร์ชันเผยแพร่`; else pass through raw.
3. Stuck-guard: when `check()` resolves `{ok:true}`, start a ~30s timer; if no `available`/`none`/`error` event flips the phase, reset to `idle` with `restMsg`/error `เช็กอัปเดตไม่ตอบสนอง — ลองใหม่`. Clear the timer in the event handlers and on unmount.
4. Extend `src/renderer/settings/updater.test.ts` — **check first whether this test file exists; create it if not** — covering: download-error wording, friendly mapping, stuck-check timeout (vitest fake timers).

### H3 — Make "รีสตาร์ทแล้วติดตั้ง" silent, matching quit-behavior

**Why:** [electron/main.ts:609](../electron/main.ts) calls `quitAndInstall(false, true)` — `isSilent=false` re-runs the **full NSIS wizard** (dir picker etc.) on every single update. Meanwhile `autoInstallOnAppQuit=true` (line 56) installs **silently** when the user just quits normally. Same update, two very different experiences; the explicit button gives the *worse* one.

**Change:** `quitAndInstall(true, true)` (silent + relaunch). NSIS assisted installers accept `/S`; `perMachine:false` means no UAC prompt. Update the comment on lines 606-608 accordingly. Keep `oneClick:false` in package.json untouched (first-install wizard is unaffected).

---

## MEDIUM / nice-to-have (post-release OK)

### M1 — CI hardening
- `.github/workflows/release.yml`: add `- run: npm run typecheck` between `npm test` and `npm run build` (script exists in package.json; CI currently lets type errors ship).
- (Artifact assertions covered by C3.)

### M2 — Release & rollback runbook (`docs/RELEASE_RUNBOOK.md`, new file)
Write the operational doc the current setup implies but never states:
- **Publish checklist:** tag == version (CI enforces) → CI draft release → verify assets (`Setup.exe`, `.zip`, `latest.yml`, `.blockmap`) → for `-beta/-rc` versions confirm the *pre-release* flag → publish.
- **Staged rollout (works today, zero code):** publish as *pre-release* first → only existing beta/prerelease users auto-update (electron-updater `allowPrerelease` is version-derived) → observe → then release the stable version. Optionally note electron-builder `stagingPercentage` exists but is **not** wired for the GitHub provider — do not promise it.
- **Rollback:** clients have `allowDowngrade=false` (default) — you can never pull users *back*. Broken release procedure: (1) immediately mark the bad GitHub Release as *pre-release* (or delete its `latest.yml` asset) so no new client picks it up; (2) ship the fix as a **higher** version (re-tag of last-good content if needed, e.g. `0.2.2` = `0.2.0` code); (3) never delete tags/releases users already installed — `deleteAppDataOnUninstall:false` keeps their data safe either way.
- The one-time C3 manual VM gate.
- Existing note from distribution plan to repeat here: users who moved the NSIS install dir may need a manual reinstall for updates.

### M3 — Small state polish (renderer, optional)
- [updater.ts](../src/renderer/settings/updater.ts): clicking เช็กอัปเดต while phase is `downloaded` silently discards the "restart to install" state until events re-arrive. Either disable the check button when `downloaded`, or preserve `downloaded` unless a *newer* version is announced.
- No periodic re-check exists (banner checks once on mount; updater only manual). Acceptable for now; if added later, a 6-12h `setInterval` calling the same `check()` is enough — do **not** enable `autoDownload` without a user setting.

---

## Q&A — direct answers to the audit questions (leave these as-is; no code change)

- **`autoDownload=false` + `autoInstallOnAppQuit=true` — intentional?** Yes — documented in `docs/distribution-release-plan.md` Task 2.2. UX: user must click ดาวน์โหลด once; after download, either click รีสตาร์ทแล้วติดตั้ง or just quit normally (installs silently on quit). If the user never clicks ดาวน์โหลด, nothing installs — that's the accepted manual-consent design. Only H3's wizard-vs-silent inconsistency needs fixing.
- **update-downloaded but user keeps the app open for days?** Nothing breaks: the downloaded installer sits in cache and applies on next quit. If an even newer version ships meanwhile, the stale one installs on quit and the next check picks up the newer — mildly wasteful, harmless. No action.
- **Code signing vs SmartScreen?** Unsigned is a *decided tradeoff* (distribution plan: "Auto-update is unsigned for now"), with CI seams ready for `CSC_LINK`/`CSC_KEY_PASSWORD`. Users will see SmartScreen on first install and on browser-downloaded installers (another reason for H1 — in-app silent updates avoid repeated prompts). No change now.
- **Publish provider vs workflow match?** Verified consistent: `package.json` `build.publish` → github/Bank848/claudedeck; workflow publishes with `GITHUB_TOKEN` from the same repo; `REPO` constant in main.ts:27 matches. Requires the repo to be public (it is, per the beta-release goal).
- **Downgrade protection?** electron-updater default `allowDowngrade=false` — fine. The REST path never triggers downloads, only opens a webpage, so C2's fix is about *notification* correctness, not downgrade risk.

## Verification (executor: run all before closing)

- [ ] `npm test` green including new `electron/version.test.ts` + updater hook tests.
- [ ] `npm run typecheck` green.
- [ ] Push a `-beta` tag to a scratch branch/fork → CI: tag-guard passes, release is drafted **pre-release-flagged**, artifact assertions pass.
- [ ] VM: previous NSIS install → in-app check/download/restart-install → relaunches on new version (C3 gate).
- [ ] Beta-version app (`0.2.0-beta.1`) sees a stable `0.2.0` release in the startup banner (C2 fixed).
- [ ] Kill network mid-download → error reads "ดาวน์โหลดอัปเดตไม่สำเร็จ…" not "เช็กไม่ได้…" (H2).
