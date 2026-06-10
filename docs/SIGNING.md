# Code signing ClaudeDeck (Windows)

ClaudeDeck currently ships **unsigned**. The app installs and auto-updates fine
without a certificate, but Windows SmartScreen shows a blue "Windows protected
your PC" prompt on first run (the user clicks **More info → Run anyway**). Adding
a certificate removes that prompt. **No code changes are needed** — the CI
workflow already has the env seams; signing is enabled purely by adding secrets.

## Why it's off for now

A code-signing certificate costs money and (for the SmartScreen reputation to
build) takes time:

- **OV** (Organization Validation) `.pfx` — ~\$200–400/yr, SmartScreen warning
  fades only after enough installs build reputation.
- **EV** (Extended Validation) — ~\$300–600/yr, instant SmartScreen trust, but
  requires a hardware token (or a cloud signing service).
- **Azure Trusted Signing** — ~\$10/mo, cloud-based, no hardware token; the
  cleanest modern path if you have an eligible Azure account.

Until one of these is in place, distribution works; users just see the one-time
SmartScreen prompt.

## Path A — OV/EV `.pfx` certificate

1. Buy an OV (or EV) code-signing cert; export it as a password-protected `.pfx`.
2. Base64-encode it:
   - PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard`
3. Add two **repository secrets** (Settings → Secrets and variables → Actions):
   - `CSC_LINK` — the base64 string from step 2.
   - `CSC_KEY_PASSWORD` — the `.pfx` password.
4. Uncomment the `CSC_LINK` / `CSC_KEY_PASSWORD` lines in
   [`.github/workflows/release.yml`](../.github/workflows/release.yml).

electron-builder detects `CSC_LINK` and signs the NSIS installer automatically.

> EV certs on a hardware token can't be base64-fed to CI — use a cloud signing
> service (e.g. Azure Trusted Signing below, or SignPath) instead.

## Path B — Azure Trusted Signing

1. Set up an Azure Trusted Signing account + certificate profile.
2. Add the `azure/trusted-signing-action` step to the `build` job (after the
   `electron-builder` step, signing the emitted `*.exe`), plus the `AZURE_*`
   secrets it needs (tenant/client/secret + endpoint + account/profile name).
3. No electron-builder config change is required beyond pointing it at the signed
   binary, or letting the action sign the `release/` output.

## Auto-update + install-folder caveat

The NSIS build is configured with `perMachine: false` and
`allowToChangeInstallationDirectory: true`. If a user **moves** the install
folder after installing, an in-place auto-update may fail to find the original
location (the updater reads the path recorded in the registry at install time).
If that happens, the fix is a manual reinstall from the latest release. The
portable **zip** build does **not** auto-update at all — those users download a
new zip from the Releases page manually.
