# ClaudeDeck — Release & Rollback Runbook

> Operational runbook for cutting a release, staging a rollout, and recovering from a bad one.
> Repo: `Bank848/claudedeck` · CI: `.github/workflows/release.yml` (tag `v*` → build + publish).
> Extends `docs/distribution-release-plan.md` and `docs/auto-update-hardening-plan.md` (M2). Do not contradict them.

Release artifacts (names come from `package.json` `build`, `productName: ClaudeDeck`):

- `ClaudeDeck-Setup-<version>.exe` — NSIS installer (auto-updatable path).
- `ClaudeDeck-<version>-win.zip` — portable build (does **not** auto-update; see caveats).
- `latest.yml` — release channel manifest electron-updater reads.
- `*.blockmap` — differential-update deltas (paired with the installer).

---

## 1. Publish checklist

Versioning is enforced by CI: the release is named after `package.json` `version`, **not** the git tag, and CI fails unless the tag equals `v<package.json version>`.

- [ ] Bump `package.json` `version` and commit on `main`.
- [ ] Tag exactly `v<version>` (e.g. `v0.2.0`, or `v0.2.0-beta.1` for a pre-release) and push the tag.
- [ ] Watch CI: tag guard → `npm ci` → `npm test` → `npm run typecheck` → `npm run build` → `electron-builder --win --publish always` → artifact assertions (`release/<version>/latest.yml`, `*.blockmap`, `win-unpacked/resources/app-update.yml` — job fails if any is missing).
- [ ] On the GitHub Release, verify all four assets are present: `ClaudeDeck-Setup-<version>.exe`, `ClaudeDeck-<version>-win.zip`, `latest.yml`, and the `.blockmap`.

Then follow the path that matches the version:

**Stable version (no `-` in the tag, e.g. `v0.2.0`):**
electron-builder's GitHub publisher defaults to `releaseType: draft` — CI creates the Release as a **draft**. This draft is the manual safety gate.
- [ ] Review the drafted release, then click **Publish release** by hand. No user sees the update until you do.

**Pre-release version (tag contains `-`, e.g. `v0.2.0-beta.1`):**
CI sets `EP_PRE_RELEASE=true` automatically, so electron-builder creates the Release **already published as a pre-release** (`draft:false, prerelease:true`) — it **skips** the draft gate.
- [ ] Open the release page right after CI finishes and confirm it is flagged **Pre-release** (it should be — no manual publish step). If for any reason it is not, tick *Set as a pre-release* immediately.

---

## 2. Staged rollout (works today, zero code)

Pre-release containment is version-derived in electron-updater: `allowPrerelease` defaults true **only** for clients whose own installed version has a pre-release suffix. Stable users only ever see stable releases; beta/pre-release users see both.

Roll out in two stages:

1. Ship the change as a **pre-release** version first (e.g. `v0.2.1-beta.1`). Only existing beta/pre-release users auto-update to it.
2. Observe (crash reports, user feedback, the C3 VM gate below for a first-of-its-kind change).
3. When it looks healthy, cut the **stable** version (e.g. `v0.2.1`) and publish the draft — stable users get it then.

> electron-builder has a `stagingPercentage` option, but it is **not** wired for the GitHub provider — do not rely on it here. The pre-release-first flow above is the actual staging mechanism.

---

## 3. Rollback / broken-release procedure

There is **no pulling users back**: clients run with `allowDowngrade=false` (the default), so a lower version will never be offered as an update. Recovery is always "roll forward."

If a bad release is already published:

1. **Stop the bleed immediately** — mark the bad GitHub Release as **pre-release** (or delete its `latest.yml` asset) so no new stable client picks it up.
2. **Ship the fix as a higher version.** If the fix is just "revert to the last-good code," re-tag that content under a higher version (e.g. `0.2.2` built from `0.2.0` code) and release normally — users move forward onto it.
3. **Never delete tags or releases users already installed.** Their app keeps working; `deleteAppDataOnUninstall:false` means their data survives reinstall/uninstall either way.

---

## 4. One-time end-to-end VM gate (C3)

Before the **first public announcement** of the in-app update path, prove it once on a real machine — CI artifact assertions cannot catch signing/path/registry issues:

- [ ] Install the **previous** NSIS build in a clean VM.
- [ ] Publish the new release as a **pre-release**.
- [ ] In the app: เช็กอัปเดต → ดาวน์โหลด → รีสตาร์ทแล้วติดตั้ง.
- [ ] Confirm the app relaunches on the new version.

---

## 5. Known caveats

- **Moved install directory** — NSIS is configured `allowToChangeInstallationDirectory:true` + `perMachine:false`. If a user moved the install folder after installing, in-place updates may break (the updater reads the original registry path). Advise those users to **reinstall manually** from the latest `ClaudeDeck-Setup-<version>.exe`.
- **Portable zip does not auto-update** — the `ClaudeDeck-<version>-win.zip` build has no `app-update.yml`; its in-app update check falls back to opening the Releases page. Zip users must download and unzip the new build manually.
- **Unsigned / SmartScreen** — code signing is intentionally absent for now. A SmartScreen warning on first install and on browser-downloaded installers is **expected**, not a bug (in-app silent updates avoid repeated prompts). CSC_LINK/CSC_KEY_PASSWORD seams are commented in the workflow; see `docs/SIGNING.md`.
