# Plan: Session management overhaul — decouple tabs from a session library

**Status:** draft (plan-pro: writing-plans + spawned review + parallel execution)
**Date:** 2026-06-13
**Phase:** 1 (tags UI + virtualization deferred to phase 2)

## Goal

Stop sessions from "piling up until you drown." Today the tab strip and the sidebar
both render *every* stored session, closing a tab **deletes** the session forever, and
there is no search/grouping/archive. We separate two concepts:

- **Tab** = a session you currently have open (`open === true`). The tab strip shows only these.
- **Session library** = every session ever, shown in the sidebar, grouped by project,
  searchable, with pin + soft-delete (archive).

Closing a tab no longer destroys anything — it sets `open: false` and the session drops
back into the sidebar. Permanent deletion is only possible from the Archive view, behind a
confirm. This is purely **additive** to the existing storage: `StoredSession.open` already
exists; we add `archived` and `pinned`, change the *semantics* of "close", and rebuild the
sidebar panel.

## Architecture / key decisions

- **Approach A (additive).** Reuse `StoredSession.open`; add `archived`/`pinned`. No
  migration: `fromStored` defaults missing fields to `false`, so old `sessions.json` loads clean.
- **Reducer stays pure & immutable** (existing pattern in `useSessions.ts`). New actions:
  `closeTab`, `reopenTab`, `togglePin`, `setArchived`, plus reuse existing `closeSession`
  (hard delete) and `setTitle` (rename).
- **Grouping/sort is a pure helper** (`groupSessions`) so it is unit-testable without React.
- **Transcripts are NOT touched.** Hard delete removes the session from `sessions.json` only;
  the CLI owns `~/.claude/projects/**.jsonl` and we never delete its files.
- **Accessibility-first** (blind = first-class user): group headers are real `disclosure`
  buttons with `aria-expanded`, rows keep `role="option"`, every row action is a keyboard-
  reachable button with an `aria-label`, and close/archive/undo are announced via the
  existing `speakStatus` aria-live path.
- **Phase-1 scope cut (YAGNI):** no list virtualization, no full tag UI (field reserved only).

## Tech stack

React + TypeScript (renderer), Electron main (`sessionStore.ts`), Vitest. No new deps.
Icons from `lucide-react` (already used). Tailwind tokens already in `tokens.css`.

## File structure

```
electron/
  sessionStore.ts            (M) add archived/pinned to StoredSession mirror
src/renderer/
  cli/types.ts               (M) add archived/pinned to StoredSession mirror
  mock/fixtures.ts           (M) add archived?/pinned? to Session runtime type
  state/
    useSessions.ts           (M) emptySession/toStored/fromStored + new actions
    useSessions.test.ts      (M) tests for new fields + actions
    sessionGroups.ts         (A) pure groupSessions() helper
    sessionGroups.test.ts    (A) tests for grouping/sort/search
  layout/
    TabStrip.tsx             (M) empty-state when no open tabs
    Sidebar.tsx              (M) thread new handlers through
  views/sessions/
    SessionsPanel.tsx        (M) search + groups + row actions + archive view
  App.tsx                    (M) close=soft, reopen=open:true, new handlers, filter tabs
```

## Parallelization analysis

Dependency edges: Task 2 needs Task 1's fields; Task 3 needs Task 1's fields; Task 4 needs
Task 2's actions; Tasks 5/6/7 each touch a single distinct component file. The new-field
foundation (Task 1) gates everything.

- **Batch 1 (foundation, solo):** Task 1 — touches `useSessions.ts` + the three type mirrors.
- **Batch 2 (parallel, disjoint files):** Task 2 (`useSessions.ts`) ∥ Task 3 (`sessionGroups.ts`).
  *Note:* both can run concurrently because Task 3 only imports from `useSessions.ts`, doesn't
  edit it. If an executor prefers strict safety, run 2 then 3 — the cost is one extra hop.
- **Batch 3 (parallel, disjoint files):** Task 4 (`App.tsx`) ∥ Task 5 (`Sidebar.tsx`) ∥
  Task 6 (`SessionsPanel.tsx`) ∥ Task 7 (`TabStrip.tsx`). No two tasks edit the same file.
  After all four land, run the **single `tsc --noEmit` + full `vitest run` gate** — this is the
  first point everything type-checks together.

**Critical path:** Task 1 → Task 2 → Task 4 (three sequential hops). Everything else folds
into the batches above. Unit suites (Tasks 1-3) are green per-task; the only cross-file
compile gate is at the end of Batch 3.

---

## Task 1 — Data model: add `archived` + `pinned` (no migration)

Add the two flags to both `StoredSession` mirrors and the runtime `Session`, and make
`toStored`/`fromStored`/`emptySession` carry them with safe defaults.

- [ ] In `src/renderer/cli/types.ts`, extend `StoredSession` (lines 88-91):

```ts
/** Renderer mirror of electron/sessionStore.ts StoredSession — keep the two in sync. */
export interface StoredSession {
  id: string; claudeSessionId?: string; cwd: string; title: string; model: string
  tokens: number; contextTokens: number; updatedAt: string; createdAt: string; open: boolean
  /** Soft-delete: hidden from the main library, shown only in the Archive view. */
  archived?: boolean
  /** Pinned sessions float to the top of their project group. */
  pinned?: boolean
}
```

- [ ] In `electron/sessionStore.ts`, mirror the same two optional fields on its
  `StoredSession` (after `open: boolean` at line 23):

```ts
  open: boolean
  /** Soft-delete: hidden from the main library, shown only in the Archive view. */
  archived?: boolean
  /** Pinned sessions float to the top of their project group. */
  pinned?: boolean
```

- [ ] In `src/renderer/mock/fixtures.ts`, add the two optional fields to the `Session`
  interface (next to the existing `open?: boolean`):

```ts
  open?: boolean
  archived?: boolean
  pinned?: boolean
```

- [ ] In `src/renderer/state/useSessions.ts`:
  - `emptySession` (line 34) — add `archived: false, pinned: false` to the returned object.
  - `toStored` (line 38) — append `, archived: s.archived ?? false, pinned: s.pinned ?? false`.
  - `fromStored` (line 42) — append `, archived: s.archived ?? false, pinned: s.pinned ?? false`.

- [ ] In `src/renderer/state/useSessions.test.ts`, extend the round-trip test (line 104) and
  add a defaults test:

```ts
  it('toStored/fromStored carries archived + pinned', () => {
    const s = { ...emptySession('a'), pinned: true, archived: false }
    expect(toStored(s)).toMatchObject({ pinned: true, archived: false })
    expect(fromStored(toStored(s))).toMatchObject({ pinned: true, archived: false })
  })
  it('fromStored defaults missing archived/pinned to false (old index migration-free)', () => {
    const legacy = { id: 'x', cwd: 'D:/p', title: 'Old', model: 'opus-4-8', tokens: 0, contextTokens: 0, updatedAt: 'u', createdAt: 'c', open: true } as StoredSession
    expect(fromStored(legacy)).toMatchObject({ archived: false, pinned: false })
  })
```

  (Add `StoredSession` to the type import on line 2 if not already present:
  `import type { StoredSession } from '@/cli/types'`.)

- [ ] Run `npx vitest run useSessions` — green.

---

## Task 2 — Reducer actions: `closeTab`, `reopenTab`, `togglePin`, `setArchived`

Closing a tab must **not** delete. Archiving removes from tabs too. Keep `closeSession`
as the hard-delete primitive (used only by permanent delete in Task 3).

- [ ] In `src/renderer/state/useSessions.ts`, add to the `SessionsAction` union (after line 20):

```ts
  | { type: 'closeTab'; sessionId: string }
  | { type: 'reopenTab'; sessionId: string }
  | { type: 'togglePin'; sessionId: string }
  | { type: 'setArchived'; sessionId: string; archived: boolean }
```

- [ ] Add the cases (after the existing `closeSession` case, line 95):

```ts
    case 'closeTab':
      // Soft: drop out of the tab strip, stay in the library. Never deletes.
      return patchSession(state, action.sessionId, (s) => ({ ...s, open: false }))

    case 'reopenTab':
      return patchSession(state, action.sessionId, (s) => ({ ...s, open: true }))

    case 'togglePin':
      return patchSession(state, action.sessionId, (s) => ({ ...s, pinned: !s.pinned }))

    case 'setArchived':
      // Archiving also closes the tab (an archived session can't be "open").
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        archived: action.archived,
        open: action.archived ? false : s.open,
      }))
```

- [ ] In `src/renderer/state/useSessions.test.ts`, add a `describe('library actions')` block:

```ts
describe('library actions', () => {
  const open = (id: string, over = {}) => ({ ...emptySession(id), ...over })

  it('closeTab sets open:false without removing the session', () => {
    const s0 = { sessions: [open('a'), open('b')] }
    const s1 = sessionsReducer(s0, { type: 'closeTab', sessionId: 'a' })
    expect(s1.sessions.map((s) => s.id)).toEqual(['a', 'b'])
    expect(s1.sessions[0].open).toBe(false)
  })
  it('reopenTab sets open:true', () => {
    const s0 = { sessions: [open('a', { open: false })] }
    expect(sessionsReducer(s0, { type: 'reopenTab', sessionId: 'a' }).sessions[0].open).toBe(true)
  })
  it('togglePin flips pinned', () => {
    const s0 = { sessions: [open('a', { pinned: false })] }
    expect(sessionsReducer(s0, { type: 'togglePin', sessionId: 'a' }).sessions[0].pinned).toBe(true)
  })
  it('setArchived true archives AND closes the tab', () => {
    const s0 = { sessions: [open('a', { open: true })] }
    const s1 = sessionsReducer(s0, { type: 'setArchived', sessionId: 'a', archived: true })
    expect(s1.sessions[0]).toMatchObject({ archived: true, open: false })
  })
  it('setArchived false unarchives, leaving open untouched', () => {
    const s0 = { sessions: [open('a', { archived: true, open: false })] }
    const s1 = sessionsReducer(s0, { type: 'setArchived', sessionId: 'a', archived: false })
    expect(s1.sessions[0]).toMatchObject({ archived: false, open: false })
  })
})
```

- [ ] Run `npx vitest run useSessions` — green.

---

## Task 3 — Grouping helper: `groupSessions` (search + project group + sort)

Pure, React-free, fully testable. Drives the sidebar.

- [ ] Create `src/renderer/state/sessionGroups.ts`:

```ts
import type { Session } from '@/mock/fixtures'

export interface SessionGroup {
  /** Display key: the cwd basename (or 'Unknown' for blank cwd). */
  project: string
  /** Full cwd of the first session (for tooltip/aria). */
  cwd: string
  sessions: Session[]
}

function basename(cwd: string): string {
  return cwd.split(/[/\\]/).filter(Boolean).pop() || 'Unknown'
}

/** pinned first, then most-recently-updated. Stable for equal keys. */
function byPinThenRecency(a: Session, b: Session): number {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
  return (b.updatedAt || '').localeCompare(a.updatedAt || '')
}

/**
 * Filter by archived state + a free-text query (matches title or cwd basename,
 * case-insensitive), then bucket by project and sort within each bucket.
 * Groups are ordered by their most-recent session.
 */
export function groupSessions(
  sessions: Session[],
  opts: { query?: string; showArchived?: boolean } = {},
): SessionGroup[] {
  const q = (opts.query ?? '').trim().toLowerCase()
  const showArchived = opts.showArchived ?? false

  const visible = sessions.filter((s) => {
    if (!!s.archived !== showArchived) return false
    if (!q) return true
    return s.title.toLowerCase().includes(q) || basename(s.cwd).toLowerCase().includes(q)
  })

  const buckets = new Map<string, SessionGroup>()
  for (const s of visible) {
    const project = basename(s.cwd)
    const g = buckets.get(project) ?? { project, cwd: s.cwd, sessions: [] }
    g.sessions.push(s)
    buckets.set(project, g)
  }

  const groups = [...buckets.values()]
  for (const g of groups) g.sessions.sort(byPinThenRecency)
  groups.sort((a, b) => byPinThenRecency(a.sessions[0], b.sessions[0]))
  return groups
}
```

- [ ] Create `src/renderer/state/sessionGroups.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupSessions } from './sessionGroups'
import { emptySession } from './useSessions'

const mk = (id: string, over: Partial<ReturnType<typeof emptySession>> = {}) =>
  ({ ...emptySession(id), ...over })

describe('groupSessions', () => {
  it('buckets by cwd basename', () => {
    const g = groupSessions([
      mk('a', { cwd: 'D:/work/alpha', updatedAt: '2026-06-13T02:00:00Z' }),
      mk('b', { cwd: 'D:/work/beta', updatedAt: '2026-06-13T01:00:00Z' }),
      mk('c', { cwd: 'D:/work/alpha', updatedAt: '2026-06-13T03:00:00Z' }),
    ])
    expect(g.map((x) => x.project)).toEqual(['alpha', 'beta'])
    expect(g[0].sessions.map((s) => s.id)).toEqual(['c', 'a']) // recency desc
  })
  it('floats pinned to the top of a group', () => {
    const g = groupSessions([
      mk('a', { cwd: 'D:/p', updatedAt: '2026-06-13T03:00:00Z' }),
      mk('b', { cwd: 'D:/p', updatedAt: '2026-06-13T01:00:00Z', pinned: true }),
    ])
    expect(g[0].sessions.map((s) => s.id)).toEqual(['b', 'a'])
  })
  it('hides archived by default and shows them when asked', () => {
    const all = [mk('a', { cwd: 'D:/p' }), mk('b', { cwd: 'D:/p', archived: true })]
    expect(groupSessions(all).flatMap((g) => g.sessions.map((s) => s.id))).toEqual(['a'])
    expect(groupSessions(all, { showArchived: true }).flatMap((g) => g.sessions.map((s) => s.id))).toEqual(['b'])
  })
  it('query matches title or cwd basename, case-insensitive', () => {
    const all = [
      mk('a', { cwd: 'D:/p', title: 'Fix the parser' }),
      mk('b', { cwd: 'D:/renpy-thing', title: 'Other' }),
    ]
    expect(groupSessions(all, { query: 'PARSER' }).flatMap((g) => g.sessions.map((s) => s.id))).toEqual(['a'])
    expect(groupSessions(all, { query: 'renpy' }).flatMap((g) => g.sessions.map((s) => s.id))).toEqual(['b'])
  })
})
```

- [ ] Run `npx vitest run sessionGroups` — green.

---

## Task 4 — App wiring: soft close, reopen-opens-tab, library handlers, filtered tab strip

- [ ] In `src/renderer/App.tsx`, replace `closeSessionTab` (lines 749-757):

```ts
  const closeSessionTab = (id: string): void => {
    const openSessions = sessions.filter((s) => s.open)
    const idx = openSessions.findIndex((s) => s.id === id)
    sessionsDispatch({ type: 'closeTab', sessionId: id })
    if (id === activeSessionId) {
      // Land on another OPEN tab if one exists. If this was the last open tab,
      // intentionally leave activeSessionId on it: the center pane keeps showing
      // that conversation (you can keep reading / typing to resume it) while the
      // tab strip shows the empty-state hint (Task 7). This is by design, not a bug.
      const fallback = openSessions[idx + 1] ?? openSessions[idx - 1]
      if (fallback) setActiveSessionId(fallback.id)
    }
    speakStatus(say({ th: 'ปิดแท็บแล้ว เซสชันยังอยู่ในแถบข้าง', en: 'Tab closed; session kept in the sidebar' }))
  }
```

**Behavior note (reviewer-flagged):** `activeSession` in App.tsx is derived as
`sessions.find((s) => s.id === activeSessionId) ?? sessions[0]`, so it always resolves to a
real session even when no tab is open — the center pane never crashes. When the last tab is
closed (or the only open tab is archived), the active id stays on that now-closed session:
the chat remains visible and usable, the tab strip shows the hint. `archiveSession` below
follows the same rule (falls back to another open tab if one exists, otherwise leaves the
active id put). Do **not** force-blank the center pane.

- [ ] Replace `reopenSession` (lines 758-766) so picking a library session re-opens it as a tab:

```ts
  const reopenSession = async (id: string): Promise<void> => {
    sessionsDispatch({ type: 'reopenTab', sessionId: id })
    setActiveSessionId(id)
    setActivity('chat')
    const s = sessions.find((x) => x.id === id)
    if (s && s.messages.length === 0 && s.claudeSessionId) {
      const ok = await loadHistory(id, s.claudeSessionId)
      if (!ok) speakStatus(say({ th: 'ประวัติโหลดไม่ได้ แต่คุยต่อได้', en: 'History unavailable; you can still continue' }))
    }
  }
```

- [ ] Add library handlers right after `reopenSession`:

```ts
  const pinSession = (id: string): void => {
    sessionsDispatch({ type: 'togglePin', sessionId: id })
    const s = sessionsRef.current.find((x) => x.id === id)
    speakStatus(s?.pinned
      ? say({ th: 'เลิกปักหมุดแล้ว', en: 'Unpinned' })
      : say({ th: 'ปักหมุดแล้ว', en: 'Pinned' }))
  }
  const archiveSession = (id: string): void => {
    sessionsDispatch({ type: 'setArchived', sessionId: id, archived: true })
    if (id === activeSessionId) {
      const fallback = sessions.find((s) => s.open && s.id !== id)
      if (fallback) setActiveSessionId(fallback.id)
    }
    speakStatus(say({ th: 'เก็บเข้าคลังแล้ว เลิกทำได้ในหน้า Archive', en: 'Archived; undo from the Archive view' }))
  }
  const unarchiveSession = (id: string): void => {
    sessionsDispatch({ type: 'setArchived', sessionId: id, archived: false })
    speakStatus(say({ th: 'กู้คืนจากคลังแล้ว', en: 'Restored from archive' }))
  }
  const deleteSession = (id: string): void => {
    sessionsDispatch({ type: 'closeSession', sessionId: id })
    speakStatus(say({ th: 'ลบเซสชันถาวรแล้ว', en: 'Session permanently deleted' }))
  }
  const renameSession = (id: string, title: string): void => {
    sessionsDispatch({ type: 'setTitle', sessionId: id, title })
  }
```

  Note: `pinSession` reads `sessionsRef.current` (already declared at line 156) for the
  pre-toggle value so the announcement matches the action.

- [ ] Filter the tab strip to open sessions only — change the `<TabStrip sessions={sessions}`
  prop (line 891) to:

```tsx
                    sessions={sessions.filter((s) => s.open)}
```

- [ ] Pass the new handlers into `<Sidebar>` (lines 873-880). Add props:

```tsx
                  onPin={pinSession}
                  onArchive={archiveSession}
                  onUnarchive={unarchiveSession}
                  onDelete={deleteSession}
                  onRename={renameSession}
```

- [ ] `cycleSession` (line 168) should cycle only open tabs (so Alt+arrows don't jump to a
  closed library session). Change its body to operate on `sessions.filter((s) => s.open)`:

```ts
  const cycleSession = (dir: 1 | -1): void =>
    setActiveSessionId((cur) => {
      const open = sessions.filter((s) => s.open)
      if (open.length === 0) return cur
      const i = open.findIndex((s) => s.id === cur)
      const next = (i + dir + open.length) % open.length
      return open[next].id
    })
```

- [ ] Do **not** run `tsc` here — Tasks 4-6 are one atomic compile unit (Sidebar/SessionsPanel
  props don't exist yet until Task 5/6). The vitest suites from Tasks 1-3 stay green
  independently; the single `tsc --noEmit` gate runs at the end of Task 7.

---

## Task 5 — Sidebar: thread the new handlers through

- [ ] In `src/renderer/layout/Sidebar.tsx`, extend `SidebarProps` (lines 4-11):

```ts
interface SidebarProps {
  activity: ActivityId
  sessions: Session[]
  activeSessionId: string
  onSelectSession: (id: string) => void
  onFork?: () => void
  onNew?: () => void
  onPin?: (id: string) => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
}
```

- [ ] Destructure the new props in both `Sidebar` and `SidebarBody`, and forward them to
  `<SessionsPanel>` (lines 61-67):

```tsx
      <SessionsPanel
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={onSelectSession}
        onFork={onFork}
        onNew={onNew}
        onPin={onPin}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDelete={onDelete}
        onRename={onRename}
      />
```

  (Add the five props to the `SidebarBody({ ... })` destructure on lines 51-58 and to the
  `<Sidebar>`→`<SidebarBody>` pass-through on lines 38-45.)

---

## Task 6 — SessionsPanel: search + groups + row actions + archive view (a11y-first)

Rewrite the panel around `groupSessions`. Keep the existing helpers
(`getRelativeTime`, `formatCwdBasename`, `formatTokens`, `STATUS_DOT`).

- [ ] Replace `src/renderer/views/sessions/SessionsPanel.tsx` with:

```tsx
import { useMemo, useState } from 'react'
import { Plus, GitBranch, Pin, Archive, ArchiveRestore, Trash2, Search, ChevronDown, ChevronRight } from 'lucide-react'
import { type Session, type SessionStatus } from '@/mock/fixtures'
import { groupSessions } from '@/state/sessionGroups'

const STATUS_DOT: Record<SessionStatus, string> = {
  active: 'bg-accent', running: 'bg-success', idle: 'bg-fg-muted', error: 'bg-destructive',
}

function getRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(0)}K`
  return `${(tokens / 1000000).toFixed(1)}M`
}

interface SessionsPanelProps {
  sessions: Session[]
  activeSessionId: string
  onSelect: (id: string) => void
  onFork?: () => void
  onNew?: () => void
  onPin?: (id: string) => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
}

export default function SessionsPanel(props: SessionsPanelProps): JSX.Element {
  const { sessions, activeSessionId, onSelect, onFork, onNew } = props
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const groups = useMemo(
    () => groupSessions(sessions, { query, showArchived }),
    [sessions, query, showArchived],
  )
  const archivedCount = useMemo(() => sessions.filter((s) => s.archived).length, [sessions])

  return (
    <div className="flex flex-col">
      {onNew && (
        <button
          type="button"
          onClick={onNew}
          aria-label="New session"
          className="mx-2 mb-1 mt-2 flex items-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-left text-xs font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus size={13} className="shrink-0" />
          <span>New session</span>
        </button>
      )}
      {onFork && (
        <button
          type="button"
          onClick={onFork}
          aria-label="Fork the active conversation into a new tab"
          title="Fork conversation — copies the chat into a new tab (Ctrl+Shift+B)"
          className="mx-2 mb-1 mt-1 flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-left text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <GitBranch size={13} className="shrink-0" />
          <span className="truncate">Fork active session</span>
        </button>
      )}

      {/* Search */}
      <div className="mx-2 mb-1 mt-1 flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 focus-within:border-accent">
        <Search size={13} className="shrink-0 text-fg-muted" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={showArchived ? 'Search archive…' : 'Search sessions…'}
          aria-label="Search sessions by title or project"
          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
        />
      </div>

      {groups.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-fg-muted">
          {showArchived ? 'Archive is empty' : query ? 'No matches' : 'No sessions yet'}
        </p>
      ) : (
        <nav aria-label="Session library" className="px-1 py-1">
          {groups.map((g) => {
            const isCollapsed = collapsed[g.project] ?? false
            return (
              <section key={g.project} role="group" aria-label={`Project ${g.project}`}>
                <h3 className="px-1">
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.project]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    title={g.cwd}
                    className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-muted transition-colors hover:text-fg"
                  >
                    {isCollapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                    <span className="truncate">{g.project}</span>
                    <span className="ml-auto font-normal opacity-60">{g.sessions.length}</span>
                  </button>
                </h3>
                {!isCollapsed && (
                  <ul aria-label={`${g.project} sessions`} className="mb-1 space-y-0.5 px-1">
                    {g.sessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        active={session.id === activeSessionId}
                        showArchived={showArchived}
                        onSelect={onSelect}
                        onPin={props.onPin}
                        onArchive={props.onArchive}
                        onUnarchive={props.onUnarchive}
                        onDelete={props.onDelete}
                        onRename={props.onRename}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </nav>
      )}

      {/* Archive toggle */}
      {(archivedCount > 0 || showArchived) && (
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          aria-pressed={showArchived}
          className="mx-2 mb-2 mt-1 flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-left text-xs text-fg-muted transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Archive size={13} className="shrink-0" aria-hidden="true" />
          <span>{showArchived ? 'Back to active sessions' : `Archive (${archivedCount})`}</span>
        </button>
      )}
    </div>
  )
}

function SessionRow({
  session, active, showArchived, onSelect, onPin, onArchive, onUnarchive, onDelete, onRename,
}: {
  session: Session
  active: boolean
  showArchived: boolean
  onSelect: (id: string) => void
  onPin?: (id: string) => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
}): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const openTab = session.open ? 'open' : 'idle'
  const label = `${session.title}, ${openTab}, ${session.model}, ${getRelativeTime(session.updatedAt)}${session.pinned ? ', pinned' : ''}`

  const commitRename = (): void => {
    const t = draft.trim()
    if (t && t !== session.title) onRename?.(session.id, t)
    setRenaming(false)
  }

  return (
    <li className="group relative">
      {confirmingDelete ? (
        <div
          role="alertdialog"
          aria-label={`Delete ${session.title} permanently?`}
          className="mx-1 flex items-center gap-2 rounded-md border border-destructive bg-bg px-2 py-1.5 text-xs"
        >
          <span className="min-w-0 flex-1 truncate text-fg">Delete “{session.title}” forever?</span>
          <button
            type="button"
            autoFocus
            onClick={() => { setConfirmingDelete(false); onDelete?.(session.id) }}
            className="shrink-0 rounded bg-destructive px-2 py-0.5 font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="shrink-0 rounded border border-border px-2 py-0.5 text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancel
          </button>
        </div>
      ) : renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') { setDraft(session.title); setRenaming(false) }
          }}
          aria-label={`Rename ${session.title}`}
          className="mx-1 w-[calc(100%-0.5rem)] rounded border border-accent bg-bg px-2 py-1 text-sm text-fg outline-none"
        />
      ) : (
        <div className={`flex items-center rounded-md transition-colors ${active ? 'bg-surface-2' : 'hover:bg-surface-2'}`}>
          {active && <div className="absolute inset-y-0 left-0 w-1 rounded-l-md bg-accent" aria-hidden="true" />}
          <button
            type="button"
            onClick={() => onSelect(session.id)}
            onDoubleClick={() => onRename && setRenaming(true)}
            aria-label={label}
            aria-current={active ? 'true' : undefined}
            className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left"
          >
            <div className="flex items-center gap-2">
              {session.pinned && <Pin size={10} className="shrink-0 text-accent" aria-hidden="true" />}
              <span className={`h-2 w-2 shrink-0 rounded-full ${session.open ? STATUS_DOT[session.status] : 'bg-transparent ring-1 ring-fg-muted'}`} aria-hidden="true" />
              <span className="truncate text-sm font-medium text-fg">{session.title}</span>
            </div>
            <div className="flex items-center gap-1 pl-4 text-xs text-fg-muted">
              <span className="shrink-0">{session.model}</span>
              <span>•</span>
              <span className="shrink-0 font-mono">{formatTokens(session.tokens)}</span>
              <span>•</span>
              <span className="shrink-0">{getRelativeTime(session.updatedAt)}</span>
            </div>
          </button>

          {/* Row actions — keyboard reachable, revealed on hover/focus */}
          <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {showArchived ? (
              <>
                {onUnarchive && (
                  <button type="button" aria-label={`Restore ${session.title} from archive`} title="Restore"
                    onClick={() => onUnarchive(session.id)}
                    className="rounded p-1 text-fg-muted hover:bg-surface hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <ArchiveRestore size={13} />
                  </button>
                )}
                {onDelete && (
                  <button type="button" aria-label={`Delete ${session.title} permanently`} title="Delete permanently"
                    onClick={() => setConfirmingDelete(true)}
                    className="rounded p-1 text-fg-muted hover:bg-surface hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <Trash2 size={13} />
                  </button>
                )}
              </>
            ) : (
              <>
                {onPin && (
                  <button type="button" aria-label={session.pinned ? `Unpin ${session.title}` : `Pin ${session.title}`} title={session.pinned ? 'Unpin' : 'Pin'}
                    onClick={() => onPin(session.id)}
                    className={`rounded p-1 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${session.pinned ? 'text-accent' : 'text-fg-muted hover:text-fg'}`}>
                    <Pin size={13} />
                  </button>
                )}
                {onRename && (
                  <button type="button" aria-label={`Rename ${session.title}`} title="Rename"
                    onClick={() => setRenaming(true)}
                    className="rounded p-1 text-fg-muted hover:bg-surface hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    {/* pencil glyph via lucide could be added; reuse text for now */}
                    <span aria-hidden="true" className="text-xs">✎</span>
                  </button>
                )}
                {onArchive && (
                  <button type="button" aria-label={`Archive ${session.title}`} title="Archive"
                    onClick={() => onArchive(session.id)}
                    className="rounded p-1 text-fg-muted hover:bg-surface hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <Archive size={13} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
```

- [ ] `npx tsc --noEmit` — clean.

---

## Task 7 — TabStrip empty state (no open tabs)

Now that closing the last tab is allowed, render a hint instead of an empty bar.

- [ ] In `src/renderer/layout/TabStrip.tsx`, inside the scroll container (after the
  `sessions.map(...)` block, still inside the `flex-1` div at line 24-76), add an empty hint:

```tsx
        {sessions.length === 0 && (
          <div className="flex items-center px-3 text-xs text-fg-muted" role="status">
            No open tabs — pick a session from the sidebar, or press + for a new one.
          </div>
        )}
```

  (The `+` button at lines 77-85 stays outside the conditional so a new tab is always one click away.)

- [ ] `npx vitest run` and `npx tsc --noEmit` — all green.

---

## Manual verification (preview)

1. `preview_start`; open several sessions across ≥2 cwds.
2. Close a tab → it disappears from the strip, **reappears** in the sidebar under its project
   group; aria-live announces "Tab closed; session kept in the sidebar".
3. Close every tab → tab strip shows the empty hint; `+` still works.
4. Click a library session → opens as a tab, becomes active, history loads.
5. Type in Search → groups filter live by title and project.
6. Pin a session → it floats to the top of its group with a pin glyph.
7. Archive a session → leaves the active list; open the Archive toggle → it's there; Restore
   brings it back; Delete (in archive) prompts confirm then removes it.
8. Reload the app → open tabs restore, pins/archive state persist (check `sessions.json`).
9. Keyboard-only pass: Tab through search → group headers (expand/collapse) → rows → row
   actions; every control reachable and labelled.

## Out of scope (phase 2)

- Tag UI (field reserved, no editor).
- List virtualization (only needed at hundreds of sessions).
- Drag-to-reorder / manual sort.
