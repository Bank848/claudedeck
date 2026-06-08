# In-app Login + Logout — Design Spec

**Date:** 2026-06-08
**Status:** Approved (brainstorm) — ready for plan
**Backlog item:** #1 (priority, set by user 2026-06-08)

## Problem

ClaudeDeck's Live mode spawns the real `claude` CLI, which only works when the
user is authenticated. Today authentication requires running `claude auth login`
in a terminal — bad UX, and impossible for non-technical "other users" the app is
meant to serve (violates the project's ready-to-use principle). We need **login,
logout, and account/status visibility entirely in-app.**

## Research (verified live against the installed CLI, 2026-06-08)

- Auth verb is `claude auth <login|logout|status>` (NOT `claude login`).
- `claude auth status --json` → machine-readable:
  `{ loggedIn, authMethod, apiProvider, email, orgId, orgName, subscriptionType }`.
  Exit 0 when logged in.
- `claude auth login --claudeai` in **non-TTY (piped)** mode:
  1. prints `Opening browser to sign in…`
  2. prints `If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?...`
  3. then **blocks on stdin** with `Paste code here if prompted > `.
  The redirect_uri is a **hosted callback page** (`platform.claude.com/oauth/code/callback`)
  that shows a code the user copies back — there is **no localhost listener**.
  Flags: `--claudeai` (default, subscription), `--console` (API billing), `--email <e>`, `--sso`.
- `claude auth logout` — no flags, non-interactive: clears creds, exits.
- Writing an empty/wrong code → stderr `Invalid code. Please make sure the full code was copied.`

This makes the **pipe + openExternal + paste-code-over-stdin** approach correct.
No PTY needed (consistent with Slice A's deliberate no-`node-pty` choice).

## Decisions (user, 2026-06-08)

1. **UI surface:** Settings "Account" section **+** a dismissible logged-out banner at top of chat.
2. **Auth types:** Claude subscription only (`--claudeai`). Console/SSO are out of scope.
3. **Code entry:** Auto-open browser via `shell.openExternal`, then a paste field → stdin.

## Architecture

A new **`auth` IPC namespace** parallel to `claude:*`. Kept separate because login
is a *long-lived interactive* child that waits for the pasted code, unlike the
turn-based `claude:start`.

### `electron/auth.ts` (new — mirrors `claude.ts`)
Holds a single live `loginProc: ChildProcess | null`.

- `getAuthStatus(): Promise<AuthStatus>` — spawns `claude auth status --json`, collects
  stdout, `JSON.parse` → maps to `AuthStatus`. **Any** error/non-zero/parse failure →
  `{ loggedIn: false }` (fail safe, never throws).
- `startLogin(win): { ok }` — spawns `claude auth login --claudeai` over pipes
  (same `cmd.exe /c` wrapper on Windows as `claude.ts`). Line-buffers stdout; when a
  line matches the authorize-URL regex, emit `auth:login-url` and `shell.openExternal(url)`.
  Keeps the child alive.
- `submitLoginCode(code): { ok }` — `loginProc.stdin.write(code + "\n")`. (Trim surrounding
  whitespace; reject if no live proc.)
- `cancelLogin()` — tree-kill the child (reuse Windows `taskkill /pid /T /F` pattern), clear handle.
- `logout(): Promise<{ ok }>` — spawns `claude auth logout`, resolves on exit.
- On login child `exit`: code 0 → `auth:login-done { ok:true }`; else
  `auth:login-done { ok:false, error }` (last stderr line, e.g. "Invalid code").

**Pure, unit-testable helpers (exported):**
- `extractAuthUrl(line): string | null` — regex `https:\/\/claude\.com\/cai\/oauth\/authorize\?\S+`.
- `parseAuthStatus(stdout): AuthStatus` — JSON → mapped object; bad input → `{loggedIn:false}`.
- `buildLoginArgs(): string[]` → `['auth','login','--claudeai']`.
- `buildStatusArgs()`, `buildLogoutArgs()`.

### `electron/main.ts` — register IPC
`auth:status`, `auth:login-start`, `auth:login-code`, `auth:login-cancel`, `auth:logout`.
Emits events `auth:login-url`, `auth:login-done` to the renderer. `cancelLogin()` also
called from `before-quit` (alongside `cancelAllTurns`, `stopMiku`).

### `electron/preload.ts` — surface
```
auth: {
  status(): Promise<AuthStatus>
  startLogin(): Promise<{ ok: boolean; error?: string }>
  submitCode(code: string): Promise<{ ok: boolean; error?: string }>
  cancelLogin(): Promise<{ ok: boolean }>
  logout(): Promise<{ ok: boolean }>
  onUrl(cb): () => void          // auth:login-url
  onError(cb): () => void        // auth:login-error { text }  (non-terminal, e.g. invalid code)
  onDone(cb): () => void         // auth:login-done { ok, error? }  (terminal, on child exit)
}
```

### Renderer
- **`cli/authClient.ts`** — thin wrapper over `window.claudedeck.auth` (guards for
  absence in browser-preview, like other clients).
- **`useAuth()` hook** — state `{ status: AuthStatus, phase, error }`,
  `phase = 'idle' | 'opening' | 'awaiting-code' | 'submitting' | 'error'`.
  Refreshes status on mount, after `login-done` ok, and after logout.
  The phase machine is a **pure reducer** (`authReducer`) for unit testing.
- **`LoginFlow` component** (shared) — renders per phase: Login button (idle/logged-out)
  → "Opening your browser…" → "Paste the code from your browser:" field + Submit + Cancel
  (awaiting-code) → error message with retry. Reused by both Settings and the banner.
- **Settings → Account section** (`SettingsView`) — when logged in: status dot + email +
  plan (`subscriptionType`) + **Logout** (single confirm click: button becomes
  "Click to confirm" for ~3s). When logged out: embeds `LoginFlow`.
- **`LoginBanner`** — top-of-chat, shown only when `!status.loggedIn`; dismissible for the
  session; contains a Login button that runs the same `LoginFlow`.

## Data flow (login)

```
User clicks Login
  → authClient.startLogin()  → main spawns `claude auth login --claudeai`
  → main reads stdout, finds URL → shell.openExternal(url) + emit auth:login-url
  → hook phase: opening → awaiting-code
User authenticates in browser, copies code from callback page
  → pastes into field → authClient.submitCode(code) → main writes code+\n to stdin
  → child exchanges code, exits 0 → emit auth:login-done {ok:true}
  → hook: refresh status → loggedIn:true → banner hides, Settings shows account
Invalid code (child stays alive, re-prompts on same proc — observed behavior):
  → main emits auth:login-error { text: "Invalid code…" } (from stderr)
  → field stays open in awaiting-code; user re-pastes → submitCode again (same proc)
Child exit is always terminal → auth:login-done { ok: code===0, error? }
  (ok:false only if the proc actually exits nonzero, e.g. user cancelled the URL).
```

Note: because invalid code keeps the proc alive, `awaiting-code` is re-enterable.
`auth:login-error` (non-terminal, from stderr) is distinct from `auth:login-done`
(terminal, from exit). The reducer treats `login-error` as awaiting-code + error message.

## Error handling

- `getAuthStatus` never throws → logged-out on any failure.
- Invalid/empty code → error surfaced to the flow; user can re-paste or restart.
- Browser closed / user cancels → `cancelLogin` kills child → phase idle.
- CLI not found (`detectClaude` null) → Account section shows "claude CLI not found"
  (reuse existing `claude:available`), no login attempt.
- All `auth login` stderr is surfaced, never swallowed.

## Testing (vitest, pure units — matches `electron/claude.test.ts`)

- `extractAuthUrl`: extracts URL from the real "If the browser didn't open, visit: …"
  line; returns null for unrelated lines.
- `parseAuthStatus`: valid JSON → mapped; empty/garbage/non-JSON → `{loggedIn:false}`;
  maps `subscriptionType`→plan, picks email.
- `buildLoginArgs`/`buildStatusArgs`/`buildLogoutArgs`: exact argv.
- `authReducer`: phase transitions idle→opening→awaiting-code→(done refresh | error),
  cancel→idle, submit→submitting.
- No live OAuth (browser can't be automated) — same boundary as Slice A. Manual
  Electron verify documented for the user.

## Out of scope (YAGNI)

- `--console` (API-key billing), `--sso`, `setup-token`.
- Account *switching* beyond logout→login.
- Persisting multiple accounts.

## Gate before commit

`tsc` (typecheck) + `vitest` (all green, new tests included) + `build` green.
Commit via `git commit -F -`. Push to main requires explicit user confirm.
