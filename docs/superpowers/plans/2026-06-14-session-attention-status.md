# Per-session attention status indicators

**Status:** ready for execution (reviewed — see "Review fixed" below)
**Date:** 2026-06-14
**Approach:** TDD (vitest). Every state is **transient** — never persisted, reset on restart.

> **Execution order (sequencing):** Task 7 (preload bridge + main IPC) must land **before**
> Task 6 (App.tsx wiring) compiles. `window.claudedeck` is typed as `ClaudeDeckApi` (env.d.ts),
> NOT `any`, so `window.claudedeck?.attention?.notify(...)` only type-checks once the `attention`
> block exists on the bridge — optional chaining does **not** waive the property's existence on a
> typed object. **Do Task 7 before Task 6's `tsc` gate** (or treat 6+7 as one compile unit). The
> task numbers below are written in dependency order for tests, but 7 precedes 6 for `tsc`.

---

## Goal

When several sessions run at once, the sidebar + tab strip must show *at a glance* which
session needs the user: **🟠 needs input** (a permission / question is pending), **🟢 unread**
(a turn finished in a background session you haven't read), **🔴 error**, or just running/idle.
Today everything collapses into one coarse `status` enum and a background session that finishes
or asks a question looks identical to an idle one.

We add **one transient field** — `attention?: 'needsInput' | 'unread'` — orthogonal to the
existing `status`. `status` keeps its exact current meaning (drives the spinner). `attention`
drives a colored dot, the needs-input float-to-top sort, a window-title badge, and a gated OS
notification.

### Key decisions (approved design)

1. **New field, not a new `status` value.** While waiting on a permission the CLI turn is still
   `running` (hung mid-turn), and `unread` is orthogonal to status (an `idle` session can be
   unread). Cramming these into the `status` enum would break existing tests that depend on its
   meaning and conflate two axes.
2. **Precedence `needsInput > unread`.** A session that both finished and has a pending question
   shows needs-input.
3. **Dot precedence overall: `needsInput(🟠) > error(🔴) > unread(🟢) > status`** (running/idle/active).
   Error is a real failure state and must stay visible even if a stale `unread` lingers.
   - **Caveat (reviewer-flagged):** the live CLI backend currently never sets `status: 'error'` —
     `finishTurn` always lands on `'idle'` (useSessions.ts ~89-94), and that's load-bearing for the
     auto-flush queue (it only flushes `'idle'`, App.tsx ~909). So in practice the 🔴 branch is
     reached only by fixture/sample data today; an errored *background* turn still surfaces as
     🟢 unread (its `onDone` fires) and the error detail is in the chat. **Emitting a real
     `status:'error'` from the backend is OUT OF SCOPE** (it would strand the queue). The error
     precedence in `indicatorKind` stays — correct and ready for the day the backend emits it.
4. **All transient.** `attention` is never written to `StoredSession`. `toStored` already omits
   unknown fields, so this is preserved by construction — but we assert it in a test.
5. **Set/clear logic lives in `App.tsx`** (it owns the `onPermission`/`onDone` closures and
   `activeSessionId`), dispatching a new reducer action. The reducer stays pure.
6. **Tab strip does NOT reorder** on attention — only the sidebar list floats needs-input to the
   top. Reordering tabs would make them jump under the user's cursor mid-work. Tabs only get the
   colored dot + aria text.
7. **Title-count is the primary badge** (reliable on Windows). `app.setBadgeCount`/taskbar number
   is unreliable on Windows and `setOverlayIcon` needs an image asset — both are explicitly
   **out of scope** (nice-to-have, later).
8. **OS notification gated in the main process** on `win.isFocused()` — only notify when the
   window is NOT focused; otherwise the in-app dot is enough.

### Out of scope (do NOT do)

- Changing the meaning of the `SessionStatus` enum or its values.
- Persisting attention to disk.
- The `setOverlayIcon` / taskbar numeric badge.
- Rebuilding the `AskUserQuestion` answer UI (it currently arrives as a permission request — that
  is a separate task). `needsInput` already covers it because it covers all permission requests.
- Reordering tabs in the tab strip.

---

## Review fixed (spawned 2-reviewer loop)

The draft was reviewed by two parallel agents (spec-coverage/gaps + correctness/sequencing).
Folded-in fixes:

1. **Sequencing/tsc hazard** — `window.claudedeck` is typed (`ClaudeDeckApi`), so optional chaining
   doesn't waive the `attention` property's existence; Task 6 can't `tsc`-pass before Task 7c.
   Added an explicit "do Task 7 before Task 6's tsc gate" note.
2. **Auto-flush stale-unread bug** — a finished background session marked `unread` that then
   auto-flushes a queued message would show 🟢 on a *running* session. Added Task 2c: `startTurn`
   clears `attention` at the source (+ test).
3. **Title-count IPC spam** — the count effect on `[sessions]` would fire `setTitle` on every
   stream token. Guarded with a `lastAttentionCountRef` so the IPC fires only when N changes.
4. **🔴 error dot unreachable** — the live backend never sets `status:'error'` (would strand the
   auto-flush queue). Documented as out of scope; the `error` precedence stays correct/ready;
   errored background turns still surface as 🟢 unread.
5. **Hard import removal** — dropping the now-unused `SessionStatus` import in SessionsPanel/TabStrip
   is a `noUnusedLocals` error, not optional — promoted to a required step.
6. **decidePermission** — clear the dot only when no other prompt for that session remains queued.
7. **Existing `sessionGroups.test.ts`** — extend (don't overwrite); confirm its current tests pass.
8. Notes added: non-live path intentionally skipped; `NotifyKind` deliberately separate from
   `IndicatorKind`; `setTitle` updates the taskbar/Alt-Tab label (not the in-app `<TitleBar>`);
   unread/running both green is intentional (disambiguated by float + aria).

Confirmed correct by review (no change needed): `toStored` omits `attention` by construction;
`activeSessionIdRef` is new and reads finish-time value; the single `activeSessionId` clear-effect
covers all entry points; the boot-time clear against a stale id is a harmless no-op; electron
`*.test.ts` runs under the same vitest (node env); Tailwind `rgb(var(--warning) / <alpha-value>)`
pattern matches existing tokens; Electron `Notification` usage is valid.

---

## Parallelization analysis

**Dependency view**

- **Task 1** (field on `Session` + `sessionIndicator.ts`) — foundational. `indicatorKind`/`IndicatorKind`
  is imported by Tasks 4 & 5; the `attention` field is read by Tasks 2, 3, 6. **Must go first.**
- **Task 2** (reducer `setAttention` + `startTurn` clear) — needs the field (Task 1). Touches
  `useSessions.ts`.
- **Task 3** (sort) — needs the field (Task 1). Touches `sessionGroups.ts` + its test. Disjoint
  from Task 2's file.
- **Task 4** (SessionsPanel) — needs Task 1 (`indicatorKind`) + the `warning` token. Touches
  `SessionsPanel.tsx`, `tokens.css`, `tailwind.config.ts`.
- **Task 5** (TabStrip) — needs Task 1 + the `warning` token. Touches `TabStrip.tsx`. **Shares the
  token files** (`tokens.css`, `tailwind.config.ts`) with Task 4 → if run concurrently they'd both
  edit those two files. Either do the token edit once up front, or keep 4 & 5 sequential.
- **Task 7** (preload + main IPC + `attentionNotify.ts`) — independent of the renderer state work;
  only shares nothing with Tasks 2–5. Can run early/in parallel. **Must precede Task 6's tsc.**
- **Task 6** (App.tsx wiring) — the integration point. Depends on Task 2 (`setAttention` action),
  Task 1 (field), and Task 7 (the `attention` bridge for `tsc`). **Last.**

**Suggested batches**

- **Batch 1 (sequential, foundational):** Task 1. Then immediately apply the `warning` token edit
  (the `tokens.css` + `tailwind.config.ts` two-liner from Task 4a) once, so Tasks 4 & 5 no longer
  share files.
- **Batch 2 (parallel — disjoint files):** Task 2 (`useSessions.ts`), Task 3 (`sessionGroups.ts`),
  Task 4 (`SessionsPanel.tsx`), Task 5 (`TabStrip.tsx`), Task 7 (`preload.ts` + `main.ts` +
  `attentionNotify.ts`). No file overlap once the token edit is pulled out of Batch 1.
- **Batch 3 (sequential):** Task 6 (`App.tsx`) — needs Batch 2's reducer action + bridge.
- **Final pass:** `npx vitest run` + `tsc` green, then `/code-review` + `/simplify` in parallel.

**Critical path:** Task 1 → (token edit) → Task 2 → Task 6. Longest chain ≈ 3 sequential steps;
Tasks 3/4/5/7 fan out off Task 1.

**File-overlap cautions:** Tasks 4 & 5 both touch `tokens.css` + `tailwind.config.ts` (resolved by
pulling the token edit into Batch 1). No other overlaps. Task 6 is the only writer of `App.tsx`.

---

## Architecture

```
CLI turn events (App.tsx closures, per session, sid captured)
  onPermission(req)  ─► dispatch setAttention(sid,'needsInput')  + claudedeck.attention.notify(needsInput)
  onDone()           ─► finishTurn; if sid≠activeRef ─► setAttention(sid,'unread')
                        + claudedeck.attention.notify(done)   (main gates on isFocused)
  decidePermission   ─► setAttention(req.sessionId, undefined)        (clear)
  effect[activeSessionId] ─► setAttention(activeSessionId, undefined) (clear on view)
  effect[sessions]   ─► claudedeck.attention.setCount(#attention≠null)

sessionsReducer: + 'setAttention' action (no-op-guarded, transient)

Pure helpers (unit-tested):
  state/sessionIndicator.ts  indicatorKind(session) + indicatorLabel(session)
  state/sessionGroups.ts     sort: needsInput floats above pinned+recency
  electron/attentionNotify.ts notificationContent(kind, name) → {title, body}

UI:
  SessionsPanel SessionRow  ─ dot color from indicatorKind + aria text from indicatorLabel + sort
  TabStrip                  ─ dot color from indicatorKind + sr-only aria text (no reorder)

IPC (preload `claudedeck.attention`):
  setCount(n)            ─send─► main 'app:set-attention-count' ─► win.setTitle('ClaudeDeck (N)')
  notify({kind,name,id}) ─send─► main 'app:notify' ─► if !isFocused new Notification; click→focus+'app:focus-session'
  onFocusSession(cb)     ◄─main 'app:focus-session' (notification click → switch tab)
```

## Tech stack

React 18 + TS, electron, vitest. No new dependencies. New Tailwind token `warning` (amber) for
the needs-input dot.

---

## File structure

**Modified**
- `src/renderer/mock/fixtures.ts` — add `attention?` to `Session`
- `src/renderer/state/useSessions.ts` — `setAttention` action + reducer case
- `src/renderer/state/sessionGroups.ts` — needs-input float-to-top sort
- `src/renderer/views/sessions/SessionsPanel.tsx` — dot + aria + (sort comes from sessionGroups)
- `src/renderer/layout/TabStrip.tsx` — dot + aria
- `src/renderer/App.tsx` — set/clear/notify/count wiring + focus-session subscribe
- `electron/main.ts` — IPC handlers (title count, notify+focus gating)
- `electron/preload.ts` — `attention` bridge API
- `src/renderer/theme/tokens.css` — `--warning` token
- `tailwind.config.ts` — register `warning` color

**Added**
- `src/renderer/state/sessionIndicator.ts` — pure indicator kind/label
- `src/renderer/state/sessionIndicator.test.ts`
- `src/renderer/state/sessionGroups.test.ts` (extend if exists; else create)
- `src/renderer/state/sessionAttention.test.ts` — reducer setAttention + transient assertion
- `electron/attentionNotify.ts` — pure notification content builder
- `electron/attentionNotify.test.ts`

---

## Task 1 — `attention` field + pure indicator helper (TDD)

**Goal:** add the data field and a single pure source of truth for dot-kind + aria text, used by
both the sidebar and tab strip (DRY).

### 1a. Write the test first (RED)

Create `src/renderer/state/sessionIndicator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Session } from '@/mock/fixtures'
import { indicatorKind, indicatorLabel } from './sessionIndicator'

function s(partial: Partial<Session>): Session {
  return {
    id: 'x', title: 't', cwd: '', status: 'idle', model: 'opus-4-8',
    updatedAt: '', tokens: 0, messages: [], terminalLines: [], ...partial,
  }
}

describe('indicatorKind precedence', () => {
  it('needsInput beats everything (even error + running)', () => {
    expect(indicatorKind(s({ attention: 'needsInput', status: 'error' }))).toBe('needsInput')
    expect(indicatorKind(s({ attention: 'needsInput', status: 'running' }))).toBe('needsInput')
  })
  it('error beats unread and status', () => {
    expect(indicatorKind(s({ attention: 'unread', status: 'error' }))).toBe('error')
    expect(indicatorKind(s({ status: 'error' }))).toBe('error')
  })
  it('unread beats plain status', () => {
    expect(indicatorKind(s({ attention: 'unread', status: 'idle' }))).toBe('unread')
    expect(indicatorKind(s({ attention: 'unread', status: 'running' }))).toBe('unread')
  })
  it('falls back to status when no attention/error', () => {
    expect(indicatorKind(s({ status: 'running' }))).toBe('running')
    expect(indicatorKind(s({ status: 'idle' }))).toBe('idle')
    expect(indicatorKind(s({ status: 'active' }))).toBe('active')
  })
})

describe('indicatorLabel', () => {
  it('gives an English word per kind (for aria/sr-only)', () => {
    expect(indicatorLabel(s({ attention: 'needsInput' }))).toBe('needs input')
    expect(indicatorLabel(s({ attention: 'unread', status: 'idle' }))).toBe('unread')
    expect(indicatorLabel(s({ status: 'error' }))).toBe('error')
    expect(indicatorLabel(s({ status: 'running' }))).toBe('running')
    expect(indicatorLabel(s({ status: 'idle' }))).toBe('idle')
  })
})
```

- [ ] Run `npx vitest run src/renderer/state/sessionIndicator.test.ts` → fails (module missing).

### 1b. Add the field (fixtures.ts)

In `src/renderer/mock/fixtures.ts`, inside `interface Session` (after `pinned?`, near the other
transient fields), add:

```ts
  /**
   * Transient attention flag, orthogonal to `status`. `needsInput` = a permission/
   * question is pending; `unread` = a background turn finished and hasn't been viewed.
   * undefined = nothing to surface. Precedence: needsInput > unread. NEVER persisted
   * (omitted from StoredSession), reset on restart.
   */
  attention?: 'needsInput' | 'unread'
```

### 1c. Implement the helper (GREEN)

Create `src/renderer/state/sessionIndicator.ts`:

```ts
import type { Session } from '@/mock/fixtures'

/** The visual/aural state of a session's status dot, after applying precedence. */
export type IndicatorKind = 'needsInput' | 'error' | 'unread' | 'running' | 'idle' | 'active'

/**
 * Collapse `attention` + `status` into a single dot kind.
 * Precedence: needsInput > error > unread > status (running/idle/active).
 */
export function indicatorKind(session: Session): IndicatorKind {
  if (session.attention === 'needsInput') return 'needsInput'
  if (session.status === 'error') return 'error'
  if (session.attention === 'unread') return 'unread'
  return session.status // 'running' | 'idle' | 'active'
}

const LABELS: Record<IndicatorKind, string> = {
  needsInput: 'needs input',
  error: 'error',
  unread: 'unread',
  running: 'running',
  idle: 'idle',
  active: 'active',
}

/** Plain-text status word for aria-label / sr-only — never color alone (blind-first). */
export function indicatorLabel(session: Session): string {
  return LABELS[indicatorKind(session)]
}
```

- [ ] Re-run the test → passes.
- [ ] `npx tsc --noEmit` clean.

---

## Task 2 — `setAttention` reducer action (TDD)

**Goal:** a pure, no-op-guarded reducer action to set/clear a session's attention. The no-op
guard matters: an effect will dispatch a clear on every `activeSessionId` change, and we must not
churn a new state object (which would trigger the debounced persistence save) when nothing changed.

### 2a. Test first (RED)

Create `src/renderer/state/sessionAttention.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sessionsReducer, emptySession, toStored, type SessionsState } from './useSessions'

function stateWith(...ids: string[]): SessionsState {
  return { sessions: ids.map((id) => emptySession(id)) }
}

describe('setAttention', () => {
  it('sets attention on the target session only', () => {
    const next = sessionsReducer(stateWith('a', 'b'), { type: 'setAttention', sessionId: 'a', attention: 'needsInput' })
    expect(next.sessions.find((s) => s.id === 'a')?.attention).toBe('needsInput')
    expect(next.sessions.find((s) => s.id === 'b')?.attention).toBeUndefined()
  })

  it('clears attention when attention is undefined', () => {
    const set = sessionsReducer(stateWith('a'), { type: 'setAttention', sessionId: 'a', attention: 'unread' })
    const cleared = sessionsReducer(set, { type: 'setAttention', sessionId: 'a', attention: undefined })
    expect(cleared.sessions[0].attention).toBeUndefined()
  })

  it('is a no-op (same state reference) when value is unchanged', () => {
    const base = stateWith('a') // attention already undefined
    const next = sessionsReducer(base, { type: 'setAttention', sessionId: 'a', attention: undefined })
    expect(next).toBe(base) // identity — no churn, no needless persist
  })

  it('is a no-op for an unknown session id', () => {
    const base = stateWith('a')
    const next = sessionsReducer(base, { type: 'setAttention', sessionId: 'zzz', attention: 'unread' })
    expect(next).toBe(base)
  })

  it('never persists attention (transient — absent from StoredSession)', () => {
    const set = sessionsReducer(stateWith('a'), { type: 'setAttention', sessionId: 'a', attention: 'needsInput' })
    const stored = toStored(set.sessions[0])
    expect('attention' in stored).toBe(false)
  })
})
```

- [ ] Run → fails (`setAttention` not in the action union).

### 2b. Implement (GREEN) — `src/renderer/state/useSessions.ts`

Add to the `SessionsAction` union (after `updateQueued`):

```ts
  | { type: 'setAttention'; sessionId: string; attention?: 'needsInput' | 'unread' }
```

Add the case in `sessionsReducer` (before `default`). It guards against no-op churn by returning
the **same state reference** when the value is unchanged (or the session is unknown):

```ts
    case 'setAttention': {
      const cur = state.sessions.find((s) => s.id === action.sessionId)
      if (!cur || cur.attention === action.attention) return state // no-op: no needless re-render/persist
      return patchSession(state, action.sessionId, (s) => ({ ...s, attention: action.attention }))
    }
```

> `toStored` (line ~45) already lists fields explicitly and does not include `attention`, so the
> transient invariant holds with no change. The test above locks it in.

### 2c. Clear attention when a turn starts (fixes the auto-flush stale-unread bug)

**Why:** when a background session finishes it gets `unread`. If it has a queued message, the
auto-flush effect immediately starts a new turn (`startTurn` → status `running`) — but nothing
clears `attention`, so the dot would show 🟢 unread on a session that is actually *running again*
(precedence `unread > running`). Starting any turn means "active work begins, nothing stale to
read", so clear it at the source.

In the existing `startTurn` reducer case (~63-71), add `attention: undefined` to the patch:

```ts
    case 'startTurn':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        status: 'running',
        forkPending: undefined,
        attention: undefined, // a fresh turn clears any prior needsInput/unread on this session
        messages: [...s.messages, action.userMessage, action.assistantMessage],
      }))
```

Add a test to `sessionAttention.test.ts`:

```ts
  it('startTurn clears any prior attention', () => {
    const set = sessionsReducer(stateWith('a'), { type: 'setAttention', sessionId: 'a', attention: 'unread' })
    const um = { id: 'u', role: 'user' as const, createdAt: '', parts: [] }
    const am = { id: 'm', role: 'assistant' as const, createdAt: '', parts: [], streaming: true }
    const started = sessionsReducer(set, { type: 'startTurn', sessionId: 'a', userMessage: um, assistantMessage: am })
    expect(started.sessions[0].attention).toBeUndefined()
  })
```

- [ ] Re-run → passes. `npx tsc --noEmit` clean.

---

## Task 3 — needs-input floats to the top of the sidebar list (TDD)

**Goal:** within each project group, a `needsInput` session sorts above everything (even pinned),
so the session demanding attention is impossible to miss. Pinned-then-recency order is otherwise
unchanged.

### 3a. Test first (RED)

> `src/renderer/state/sessionGroups.test.ts` **already exists** (with its own session factory and a
> "floats pinned" test). **Extend** it — append the `describe('groupSessions — needsInput float')`
> block, reuse the file's existing helper if its shape suffices (otherwise add the local `s()`
> below). Do **not** overwrite the file, and confirm its existing tests still pass after the
> comparator change (they will: `needsInput` is undefined in them, so pinned/recency still wins).

Append to `src/renderer/state/sessionGroups.test.ts` (add imports only if missing):

```ts
function s(partial: Partial<Session>): Session {
  return {
    id: 'x', title: 'x', cwd: 'D:/proj', status: 'idle', model: 'opus-4-8',
    updatedAt: '2026-06-14T00:00:00Z', tokens: 0, messages: [], terminalLines: [], ...partial,
  }
}

describe('groupSessions — needsInput float', () => {
  it('floats a needsInput session above a pinned + more-recent one', () => {
    const sessions = [
      s({ id: 'pinned', pinned: true, updatedAt: '2026-06-14T10:00:00Z' }),
      s({ id: 'needs', attention: 'needsInput', updatedAt: '2026-06-14T01:00:00Z' }),
      s({ id: 'plain', updatedAt: '2026-06-14T09:00:00Z' }),
    ]
    const order = groupSessions(sessions)[0].sessions.map((x) => x.id)
    expect(order[0]).toBe('needs')
  })

  it('keeps pinned-then-recency among non-needsInput sessions', () => {
    const sessions = [
      s({ id: 'old', updatedAt: '2026-06-14T01:00:00Z' }),
      s({ id: 'pin', pinned: true, updatedAt: '2026-06-14T00:00:00Z' }),
      s({ id: 'new', updatedAt: '2026-06-14T09:00:00Z' }),
    ]
    const order = groupSessions(sessions)[0].sessions.map((x) => x.id)
    expect(order).toEqual(['pin', 'new', 'old'])
  })

  it('unread does NOT float (only needsInput does)', () => {
    const sessions = [
      s({ id: 'unread', attention: 'unread', updatedAt: '2026-06-14T01:00:00Z' }),
      s({ id: 'recent', updatedAt: '2026-06-14T09:00:00Z' }),
    ]
    const order = groupSessions(sessions)[0].sessions.map((x) => x.id)
    expect(order).toEqual(['recent', 'unread'])
  })
})
```

- [ ] Run → the float test fails (pinned currently wins).

### 3b. Implement (GREEN) — `src/renderer/state/sessionGroups.ts`

Replace `byPinThenRecency` with an attention-aware comparator (keep the name used at both call
sites, or rename consistently). Needs-input is the highest-priority key:

```ts
/** needsInput first, then pinned, then most-recently-updated. Stable for equal keys. */
function byAttentionThenPinThenRecency(a: Session, b: Session): number {
  const an = a.attention === 'needsInput'
  const bn = b.attention === 'needsInput'
  if (an !== bn) return an ? -1 : 1
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
  return (b.updatedAt || '').localeCompare(a.updatedAt || '')
}
```

Update both call sites in `groupSessions` (the per-group sort and the group-ordering sort) to use
`byAttentionThenPinThenRecency`.

- [ ] Re-run → passes. Existing `sessionGroups` tests still green. `tsc` clean.

---

## Task 4 — SessionsPanel: dot color + aria text

**Goal:** the sidebar row dot reflects `indicatorKind`, and the row's aria-label carries the
status word (never color alone — blind-first).

### 4a. Add the `warning` token (needs-input amber)

`src/renderer/theme/tokens.css` — add after `--destructive`:

```css
  --warning: 245 158 11; /* #f59e0b — amber, needs-input */
```

`tailwind.config.ts` — add to `colors` (after `destructive`):

```ts
        warning: 'rgb(var(--warning) / <alpha-value>)',
```

### 4b. SessionsPanel.tsx

Replace the `SessionStatus`-keyed `STATUS_DOT` map with an `IndicatorKind`-keyed one and use the
helper. At the top:

```ts
import { indicatorKind, indicatorLabel, type IndicatorKind } from '@/state/sessionIndicator'
```

Replace the existing `STATUS_DOT` constant (lines ~6-8) with:

```ts
const DOT_CLASS: Record<IndicatorKind, string> = {
  needsInput: 'bg-warning',
  error: 'bg-destructive',
  unread: 'bg-success',
  running: 'bg-success',
  active: 'bg-accent',
  idle: 'bg-fg-muted',
}
```

In `SessionRow`, fold the status word into the existing aria `label` (it already concatenates
title/open/model/time). Change the `label` line (~184) to append the indicator:

```ts
  const label = `${session.title}, ${indicatorLabel(session)}, ${openTab}, ${session.model}, ${getRelativeTime(session.updatedAt)}${session.pinned ? ', pinned' : ''}`
```

Replace the dot span (~243). Keep the closed-tab ring treatment; only the open-tab color now comes
from `indicatorKind`:

```tsx
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${session.open ? DOT_CLASS[indicatorKind(session)] : 'bg-transparent ring-1 ring-fg-muted'}`}
                aria-hidden="true"
              />
```

- [ ] **Remove the now-unused `SessionStatus` import** (SessionsPanel.tsx:3 — `noUnusedLocals` makes
  this a hard `tsc` error, not optional). Keep `Session` (still used).
- [ ] `tsc` clean.
- [ ] Manual: a `needsInput` session shows an amber dot and floats to the top; aria-label reads
  "…, needs input, …".

> **Note (reviewer):** `unread` and `running` are both `bg-success` (green) — the sidebar has no
> spinner, and `running` was already green before this change, so this is not a regression. They're
> disambiguated by the float-to-top (only needsInput floats) and the aria word ("unread" vs
> "running"), satisfying blind-first. Intentional.

---

## Task 5 — TabStrip: dot color + aria text (no reorder)

**Goal:** the tab dot reflects `indicatorKind`; the sr-only status text uses `indicatorLabel`.
Tabs keep their order (no float — tabs must not jump).

`src/renderer/layout/TabStrip.tsx`. At top:

```ts
import { indicatorKind, indicatorLabel, type IndicatorKind } from '@/state/sessionIndicator'
```

Replace the `STATUS_COLOR` map (~14-19) with an `IndicatorKind`-keyed text-color map:

```ts
const DOT_COLOR: Record<IndicatorKind, string> = {
  needsInput: 'text-warning',
  error: 'text-destructive',
  unread: 'text-success',
  running: 'text-success',
  active: 'text-accent',
  idle: 'text-fg-muted',
}
```

Replace the dot + sr-only lines (~44-45):

```tsx
                <Circle size={8} className={`shrink-0 fill-current ${DOT_COLOR[indicatorKind(s)]}`} aria-hidden="true" />
                <span className="sr-only">{indicatorLabel(s)}: </span>
```

- [ ] **Remove the now-unused `SessionStatus` import** (TabStrip.tsx:2 — hard `tsc` error under
  `noUnusedLocals`). Keep `Session`.
- [ ] `tsc` clean.

---

## Task 6 — App.tsx: set / clear / notify / count wiring

**Goal:** wire the lifecycle. No new pure logic here — just dispatch + IPC at the right moments.

### 6a. A ref to the current active session id

The `onDone` closure is created when a turn starts and would capture a stale `activeSessionId`.
Mirror the existing `sessionsRef` pattern. After the `sessionsRef` block (~160-161):

```ts
  // onDone closures are created at turn-start; read the *current* active id through a
  // ref so a tab switch during the turn is reflected when the turn finishes.
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
```

### 6b. Set `needsInput` + notify when a permission arrives

In `runTurn`, inside the `onPermission` callback (~632-637), after the existing `setPermissionQueue`
+ `speakStatus`, add:

```ts
        sessionsDispatch({ type: 'setAttention', sessionId: sid, attention: 'needsInput' })
        window.claudedeck?.attention?.notify({ kind: 'needsInput', name: sess.title, sessionId: sid })
```

### 6c. Set `unread` + notify when a background turn finishes

In `runTurn`, inside `onDone` (~638-644), after `finishTurn`, before/after the queue cleanup:

```ts
      onDone: () => {
        sessionsDispatch({ type: 'finishTurn', sessionId: sid })
        // Background session finished → mark unread so the dot/badge surfaces it.
        if (sid !== activeSessionIdRef.current) {
          sessionsDispatch({ type: 'setAttention', sessionId: sid, attention: 'unread' })
        }
        // Notify regardless of which tab; main gates on window focus.
        window.claudedeck?.attention?.notify({ kind: 'done', name: sess.title, sessionId: sid })
        setPermissionQueue((q) => q.filter((r) => r.turnId !== turnId))
        activeTurnsRef.current = endActiveTurn(activeTurnsRef.current, sid, turnId)
        off()
      },
```

> Note: `sess.title` is captured at turn-start. If auto-title renamed the session mid-turn the
> notification could show "New session". Acceptable (best-effort). If we want the live title,
> read `sessionsRef.current.find((s) => s.id === sid)?.title ?? sess.title` — use that form.

Use the live-title form to avoid the stale "New session":

```ts
        const liveTitle = sessionsRef.current.find((s) => s.id === sid)?.title ?? sess.title
        window.claudedeck?.attention?.notify({ kind: 'done', name: liveTitle, sessionId: sid })
```

(Apply the same `liveTitle` pattern in 6b if desired; for needsInput the turn just started so the
captured title is fine.)

> **Non-live path is intentionally skipped.** When `claudeOk` is false, `runTurn` calls
> `finishTurn` and returns at ~577-580 *before* the `subscribe`/`onDone` block — so no unread/notify
> fires. That path is a CLI-missing stub that completes instantly with a canned message; there is
> no real background work to surface. Auto-flushed queued turns, by contrast, go through the normal
> live `subscribe` path, so they inherit the unread + notify behavior for free (the primary
> multi-session scenario this feature targets).

### 6d. Clear on answering a permission

In `decidePermission` (~779-787), after the response resolves, clear the owning session's
attention — **but only if no other permission for that same session is still queued** (a session
can have multiple pending prompts; don't drop the amber dot while one remains):

```ts
    // Clear the amber dot only when this was the LAST pending prompt for the session.
    // `permissionQueue` here is the pre-removal closure value, so exclude the answered id.
    const stillPending = permissionQueue.some((r) => r.sessionId === req.sessionId && r.id !== req.id)
    if (req.sessionId && !stillPending) {
      sessionsDispatch({ type: 'setAttention', sessionId: req.sessionId, attention: undefined })
    }
```

Place it after the `respondPermission` await (it's fine to clear even on an expired turn — the
question is gone either way).

### 6e. Clear when a session becomes the active view

Add an effect (near the other effects, after the auto-flush effect ~918). Clearing on every
`activeSessionId` change covers ALL entry points (tab click, sidebar select, voice cycle, reopen,
notification focus) without touching each call site. The reducer's no-op guard makes this cheap:

```ts
  // Viewing a session clears its attention (you've now seen it). Covers every entry
  // point (tab/sidebar/voice/notification) via the single activeSessionId signal.
  useEffect(() => {
    sessionsDispatch({ type: 'setAttention', sessionId: activeSessionId, attention: undefined })
  }, [activeSessionId])
```

### 6f. Push the attention count to the window title

The `sessions` array is a new reference on **every** stream event (each `event`/`terminal`
dispatch rebuilds it), so a naive `[sessions]` effect would fire `setCount` → `setTitle` hundreds
of times per turn. Guard on the actual count via a ref so the IPC fires only when N changes:

```ts
  // Window-title badge: count sessions awaiting attention. Main turns N into the title.
  // Guard: `sessions` churns every stream event; only push when the COUNT actually changes.
  const lastAttentionCountRef = useRef(-1)
  useEffect(() => {
    const n = sessions.filter((s) => s.attention != null).length
    if (n === lastAttentionCountRef.current) return
    lastAttentionCountRef.current = n
    window.claudedeck?.attention?.setCount(n)
  }, [sessions])
```

### 6g. Notification click → focus that session

```ts
  // A clicked OS notification asks us to jump to its session (main already focused
  // the window). Switch tab + show chat.
  useEffect(() => {
    const off = window.claudedeck?.attention?.onFocusSession?.(({ sessionId }) => {
      setActiveSessionId(sessionId)
      setActivity('chat')
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] `tsc` clean. (The `window.claudedeck?.attention?.` optional chaining keeps the renderer
  resilient if the preload bridge is older — matches the codebase's defensive IPC style.)

---

## Task 7 — preload + main IPC (title count, notify, focus)

**Goal:** the three bridge methods used in Task 6, plus a pure, tested notification-content builder.

### 7a. Pure content builder + test (TDD)

Create `electron/attentionNotify.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { notificationContent } from './attentionNotify'

describe('notificationContent', () => {
  it('needsInput → waiting-for-answer, with session name', () => {
    const c = notificationContent('needsInput', 'API limiter')
    expect(c.title).toContain('🟠')
    expect(c.body).toContain('API limiter')
  })
  it('done → finished, with session name', () => {
    const c = notificationContent('done', 'Dark mode')
    expect(c.title).toContain('🟢')
    expect(c.body).toContain('Dark mode')
  })
})
```

Create `electron/attentionNotify.ts`:

```ts
// NOTE: NotifyKind ('needsInput' | 'done') is DELIBERATELY separate from IndicatorKind
// ('needsInput' | 'error' | 'unread' | ...). A finished background turn maps to the 'unread'
// dot but the 'done' notification — do NOT pass an IndicatorKind here. The `else` below treats
// anything non-'needsInput' as done, so passing 'unread' would silently produce a done toast.
export type NotifyKind = 'needsInput' | 'done'

/** Title + body for the OS notification (Thai-first, matches the in-app voice copy). */
export function notificationContent(kind: NotifyKind, name: string): { title: string; body: string } {
  if (kind === 'needsInput') {
    return { title: '🟠 รอคำตอบ', body: `${name} ต้องการคำตอบ` }
  }
  return { title: '🟢 เสร็จแล้ว', body: `${name} ทำงานเสร็จแล้ว` }
}
```

- [ ] `npx vitest run electron/attentionNotify.test.ts` → passes.

> Confirm electron `.ts` files are covered by the vitest config (the repo already has
> `electron/*.test.ts` patterns, e.g. permission/ipc tests). If electron tests are a separate
> project, place the test where the existing electron unit tests live.

### 7b. main.ts handlers

Add `Notification` to the electron import (line 1):

```ts
import { app, shell, BrowserWindow, ipcMain, dialog, session, Notification } from 'electron'
```

Add the builder import near the other local imports (~13-20):

```ts
import { notificationContent, type NotifyKind } from './attentionNotify'
```

Inside `registerIpc()` (alongside the other `ipcMain.on(...)` window handlers near the top, ~464):

```ts
  // ── Per-session attention (transient): title badge + gated OS notification ──
  ipcMain.on('app:set-attention-count', (_e, n: number) => {
    if (!mainWindow) return
    mainWindow.setTitle(typeof n === 'number' && n > 0 ? `ClaudeDeck (${n})` : 'ClaudeDeck')
  })

  ipcMain.on(
    'app:notify',
    (_e, msg: { kind: NotifyKind; name: string; sessionId: string }) => {
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
```

> `safeSend` is already imported (line 20). `Notification.isSupported()` guards platforms/builds
> without notification support. No app-level identity needed for dev; on Windows packaged builds
> the installer sets the AppUserModelID so notifications attribute correctly (already handled by
> electron-builder; not in scope here).

### 7c. preload.ts bridge

Add an `attention` block to the `api` object (after `app:` or near `sessions`):

```ts
  /** Per-session attention: title badge count + gated OS notifications (transient). */
  attention: {
    setCount: (n: number): void => ipcRenderer.send('app:set-attention-count', n),
    notify: (msg: { kind: 'needsInput' | 'done'; name: string; sessionId: string }): void =>
      ipcRenderer.send('app:notify', msg),
    onFocusSession: (cb: (m: { sessionId: string }) => void): (() => void) => sub('app:focus-session', cb),
  },
```

(`sub` helper already exists at the top of preload.ts.)

- [ ] `tsc` clean across `electron/` and `src/`.

---

## Verification (before claiming done)

- [ ] `npx vitest run` — all suites green (new: sessionIndicator, sessionAttention, sessionGroups,
  attentionNotify; existing unchanged).
- [ ] `npx tsc --noEmit` (or the repo's typecheck script) — clean, no unused-import errors.
- [ ] Lint if the repo runs it in CI.
- [ ] Manual smoke (electron dev): run two sessions.
  - Background session asks a permission → its sidebar dot turns amber, floats to top, the
    **taskbar / Alt-Tab label** reads `ClaudeDeck (1)` (the window is `frame:false` with a React
    `<TitleBar>`, so `setTitle` updates the OS taskbar label, NOT the in-app header — expected); if
    the window is unfocused, an OS notification "🟠 รอคำตอบ" fires;
    clicking it focuses the window and switches to that session.
  - Background session finishes → green dot + title count; "🟢 เสร็จแล้ว" notification when unfocused.
  - Click into the session → dot clears, count drops.
  - Restart the app → no attention survives (all dots reset).

---

## Notes / risks

- **No-op guard is load-bearing.** Without it, the `activeSessionId` effect (6e) would mint a new
  `sessions` array on every tab switch, firing the 400ms debounced `saveIndex`. The reducer
  returns the same reference on no-op (Task 2) so a switch to an already-clear session is free.
- **Notification identity on Windows dev.** Unpackaged electron may show notifications under
  "electron.app.Electron". That's a dev-only cosmetic; packaged builds attribute correctly. Not in
  scope.
- **`window.claudedeck?.attention?.`** optional chaining everywhere in the renderer keeps a stale
  preload from throwing — consistent with the existing defensive bridge usage.
- **Tab strip intentionally does not reorder** (decision 6) — only the sidebar floats needs-input.
