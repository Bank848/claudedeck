# Plan: Real Usage feed (on-demand, OAuth) — replace mock USAGE

**Status:** ready to execute in a fresh session
**Branch:** create `feat/real-usage-feed` off `main`
**Decisions (locked):** show **utilization % + real reset times** (Anthropic exposes % only, not raw token denominators). Fetch **on-demand when the Usage view mounts** — NO background polling.

---

## Problem

`src/renderer/views/usage/UsageView.tsx` renders entirely from the static `USAGE`
fixture in `src/renderer/mock/fixtures.ts`. Every number (39%, 86,400/220,000,
"resets in 2h 14m", per-model bars) is hardcoded → the page can never sync.
Footer literally says "Phase 1 mock data".

## Verified facts (do not re-probe — costs money/tokens)

1. **App auth = `claude` CLI subscription OAuth, no API key.** Token lives at
   `~/.claude/.credentials.json` → `claudeAiOauth.accessToken` (108-char Bearer).
   Same file also has `subscriptionType`, `rateLimitTier`, `expiresAt`, `scopes`.
2. **Real usage endpoint** (this is what interactive `/usage` uses):
   ```
   GET https://api.anthropic.com/api/oauth/usage
   Authorization: Bearer <accessToken>
   anthropic-beta: oauth-2025-04-20
   ```
   Plain HTTPS GET — **does NOT consume model tokens**. Safe for on-mount fetch.
3. **Response shape (verified 2026-06-14):**
   ```json
   {
     "five_hour":        { "utilization": 82.0, "resets_at": "2026-06-13T19:19:59.395635+00:00" },
     "seven_day":        { "utilization": 10.0, "resets_at": "2026-06-18T13:59:59+00:00" },
     "seven_day_opus":   null,
     "seven_day_sonnet": { "utilization": 0.0,  "resets_at": "2026-06-18T14:00:00+00:00" },
     "extra_usage":      { "is_enabled": false, "monthly_limit": null, "used_credits": null,
                           "utilization": null, "currency": null, "disabled_reason": null }
   }
   ```
   Per-window keys can be `null` (not yet used / not applicable) — handle null.
   The endpoint gives **% only**, no raw token used/limit numbers.
4. The CLI stream also emits `rate_limit_event` (`resetsAt`, `rateLimitType`) per
   turn, but it lacks the %, and spawning a throwaway turn to read it costs ~$0.08.
   **Do not use that path** — the OAuth GET is the right source.

## Architecture (mirror existing patterns)

Three layers, same shape as the existing `auth` flow (`electron/auth.ts` +
`safeHandle` in `electron/main.ts` + `window.api.*` in `electron/preload.ts`):

### 1. New module `electron/usage.ts` (pure helpers + fetch, unit-tested)

```ts
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface UsageWindow { utilization: number; resetsAt: string }
export interface RealUsage {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  sevenDayOpus: UsageWindow | null
  sevenDaySonnet: UsageWindow | null
  extraUsageEnabled: boolean
  subscriptionType?: string
  rateLimitTier?: string
}
export type UsageResult = { ok: true; usage: RealUsage } | { ok: false; error: string }

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA = 'oauth-2025-04-20'

/** PURE: read accessToken + tier fields from credentials JSON text. */
export function parseCreds(text: string): { token?: string; subscriptionType?: string; rateLimitTier?: string } {
  try {
    const o = JSON.parse(text)?.claudeAiOauth ?? {}
    return {
      token: typeof o.accessToken === 'string' ? o.accessToken : undefined,
      subscriptionType: typeof o.subscriptionType === 'string' ? o.subscriptionType : undefined,
      rateLimitTier: typeof o.rateLimitTier === 'string' ? o.rateLimitTier : undefined,
    }
  } catch { return {} }
}

/** PURE: map raw endpoint JSON → RealUsage. Tolerates null windows + missing keys. */
export function mapUsage(raw: any, creds: { subscriptionType?: string; rateLimitTier?: string }): RealUsage {
  const win = (w: any): UsageWindow | null =>
    w && typeof w.utilization === 'number' && typeof w.resets_at === 'string'
      ? { utilization: w.utilization, resetsAt: w.resets_at } : null
  return {
    fiveHour: win(raw?.five_hour),
    sevenDay: win(raw?.seven_day),
    sevenDayOpus: win(raw?.seven_day_opus),
    sevenDaySonnet: win(raw?.seven_day_sonnet),
    extraUsageEnabled: !!raw?.extra_usage?.is_enabled,
    subscriptionType: creds.subscriptionType,
    rateLimitTier: creds.rateLimitTier,
  }
}

const credsPath = (): string => join(homedir(), '.claude', '.credentials.json')

/** Never throws. Reads token, GETs usage, maps. 401 → friendly re-auth message. */
export async function fetchUsage(): Promise<UsageResult> {
  let credsText: string
  try { credsText = await readFile(credsPath(), 'utf8') }
  catch { return { ok: false, error: 'Not signed in (no credentials found). Run `claude auth login`.' } }
  const creds = parseCreds(credsText)
  if (!creds.token) return { ok: false, error: 'No OAuth token found. Run `claude auth login`.' }
  let res: Response
  try {
    res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${creds.token}`, 'anthropic-beta': OAUTH_BETA },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Network error' } }
  if (res.status === 401) return { ok: false, error: 'Session expired. Re-authenticate with `claude auth login`.' }
  if (!res.ok) return { ok: false, error: `Usage API returned ${res.status}` }
  try {
    const raw = await res.json()
    return { ok: true, usage: mapUsage(raw, creds) }
  } catch { return { ok: false, error: 'Malformed usage response' } }
}
```

> Electron main runs on Node ≥18 → global `fetch` + `AbortSignal.timeout` available.
> Token NEVER crosses the IPC boundary — only the mapped `RealUsage` reaches the renderer.

### 2. Register handler in `electron/main.ts`

- Import: `import { fetchUsage } from './usage'`
- Alongside the other `safeHandle(...)` calls (~line 476+):
  ```ts
  safeHandle(ipcMain, 'usage:fetch', () => fetchUsage(),
    () => ({ ok: false, error: 'Failed to load usage' }))
  ```

### 3. Expose in `electron/preload.ts`

- Add to the `api` object (mirror `miku`/`claude` blocks):
  ```ts
  usage: {
    fetch: (): Promise<import('./usage').UsageResult> => ipcRenderer.invoke('usage:fetch'),
  },
  ```
- If a renderer-side `window.api` type decl exists (search `declare global` /
  `Window['api']`), extend it with `usage: { fetch(): Promise<UsageResult> }`.
  Renderer must NOT import from `electron/*` at runtime — duplicate the
  `RealUsage`/`UsageResult` types in a renderer file (e.g.
  `src/renderer/state/usage.ts`) the same way `cleanRules` is duplicated
  (see comment in `electron/claude.ts:54`), and unit-test the mapping there.

### 4. Rewire `src/renderer/views/usage/UsageView.tsx`

- Remove the `USAGE` fixture import. Add a small hook/effect:
  ```ts
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; data?: RealUsage; error?: string }>({ status: 'loading' })
  useEffect(() => {
    let live = true
    window.api.usage.fetch().then((r) => {
      if (!live) return
      setState(r.ok ? { status: 'ready', data: r.usage } : { status: 'error', error: r.error })
    })
    return () => { live = false }
  }, [])
  ```
- **Loading state:** skeleton / "Loading usage…".
- **Error state:** show `state.error` + a "Retry" button (re-runs fetch). Keep the
  a11y `role="progressbar"` bars from the current markup.
- **Ready state:** render windows from real data:
  - "5-hour limit" ← `fiveHour` (utilization %, `resetsAt` → "resets in Xh Ym" via a
    relative-time helper; reuse/extract one if present, else add a pure
    `formatResetsIn(resetsAt, now)` with tests).
  - "Weekly limit" ← `sevenDay`.
  - Per-model section ← `sevenDayOpus` / `sevenDaySonnet` (skip null ones; label
    "this week"). These are %, not token counts — change the bar to % width and
    drop the fake token numerator.
  - Show `subscriptionType` / `rateLimitTier` as a small header label (e.g. "Max
    20x · tier …").
  - If `extraUsageEnabled` → small "Extra usage on" chip.
- **Delete** the "Phase 1 mock data" footer.
- Keep `barColor(p)` (green/amber/red) keyed off utilization %.

### 5. Clean up mock

- If `USAGE` (and `Provider`/`ProviderUsage`/`UsageWindow` types) in
  `src/renderer/mock/fixtures.ts` are now unused elsewhere, remove them.
  `grep -rn "USAGE\b" src/` first — `UsagePill.tsx` / `StatusBar.tsx` may also use
  fixtures; do NOT break those (they show context %, a separate concern). Only
  remove what's truly orphaned.

## Tests (TDD — write first)

- `electron/usage.test.ts`:
  - `parseCreds` — valid JSON, missing `claudeAiOauth`, malformed JSON, missing token.
  - `mapUsage` — full payload, null windows, missing `extra_usage`, missing keys.
  - `fetchUsage` — inject a fake `fetch`/`readFile` (refactor to accept deps, or
    use module mocks consistent with `auth.test.ts` style): 200 ok, 401 → re-auth
    message, 500, network throw, missing creds file. Assert it NEVER throws.
- Renderer mapping/format tests (`src/renderer/state/usage.test.ts`):
  - `formatResetsIn` — future timestamp → "Xh Ym" / "Xd Yh"; past → "now"/"0m".
- Run `npm test` — keep the suite green (was 12 passing in the demo screenshot).

## Out of scope (note to user, don't build)

- Raw token denominators (220k/8M) — Anthropic doesn't expose them; only %.
- Background polling / live refresh — explicitly on-demand per decision.
- OAuth token refresh — if expired, surface the re-auth message; don't refresh.

## Acceptance

- Open Usage view → real %s + real reset countdowns that match interactive
  `/usage`; numbers change between sessions. Error/loading states behave. No mock
  footer. `npm test` green. Token never reaches the renderer.
