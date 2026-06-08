# ClaudeDeck — Guide / Reference Page — Implementation Plan (DRAFT)

**Goal:** Add an in-app static "wiki / cheatsheet" page (Activity `'guide'`) that documents
the `claude` CLI commands, login/auth, slash commands, and ClaudeDeck shortcuts. Curated data
file + searchable grouped view with category jump-nav. Read-only, hand-maintained, NOT
auto-updated. Spec: `docs/superpowers/specs/2026-06-08-guide-reference-page-design.md`.

**Architecture:** Mirrors the existing `SkillsBrowser` pattern — typed data module
(`reference/guide.ts`) + pure `filterGuide()` + a `GuideView` that renders grouped `<section>`s
with a search box and a `<nav>` jump list. New `'guide'` Activity wired into `ActivityBar`,
`App.centerView` switch, and `Sidebar` titles.

**Tech stack:** React 18 + TS, Tailwind v3.4 token classes (`bg-surface`, `text-fg/fg-muted`,
`text-accent`, `border-border/border-strong`), lucide-react (`BookOpen`), Vitest.

**Gate (before commit):** `npm run typecheck` && `npm run test` && `npm run build` all green.

---

## File Structure

```
src/renderer/
  mock/fixtures.ts          (MODIFY: add 'guide' to ActivityId union)
  layout/Sidebar.tsx        (MODIFY: add guide:'Guide' to TITLES — Record is exhaustive)
  layout/ActivityBar.tsx    (MODIFY: import BookOpen + add 'guide' TOP_ITEMS entry)
  reference/guide.ts        (NEW: GuideEntry/GuideSection types, GUIDE[], filterGuide())
  reference/guide.test.ts   (NEW: data-integrity + filterGuide tests)
  views/guide/GuideView.tsx (NEW: search + grouped sections + category jump-nav)
  App.tsx                   (MODIFY: import GuideView, switch case, optional voice cmd)
```

---

## Task 1 — Add `'guide'` Activity to the type + Sidebar titles

**Files:** `src/renderer/mock/fixtures.ts`, `src/renderer/layout/Sidebar.tsx`

Why both at once: `Sidebar.TITLES` is typed `Record<ActivityId, string>`. The moment `'guide'`
is added to `ActivityId`, `tsc` fails until `TITLES` gains a `guide` key. They must land together.

- [ ] In `fixtures.ts`, add `| 'guide'` to the `ActivityId` union (after `'usage'`):

```ts
export type ActivityId =
  | 'chat'
  | 'sessions'
  | 'tasks'
  | 'changes'
  | 'skills'
  | 'usage'
  | 'guide'
  | 'settings'
```

- [ ] In `Sidebar.tsx`, add the `guide` key to `TITLES`:

```ts
const TITLES: Record<ActivityId, string> = {
  chat: 'Sessions',
  sessions: 'Sessions',
  tasks: 'Boards',
  changes: 'Source Control',
  skills: 'Skill Categories',
  usage: 'Usage',
  guide: 'Guide',
  settings: 'Settings',
}
```

`SidebarBody` has a catch-all that renders a generic "Contextual panel for …" for any activity
it doesn't special-case, so `'guide'` needs no new sidebar body branch.

---

## Task 2 — `reference/guide.ts` data module + tests (TDD)

**Files:** `src/renderer/reference/guide.ts` (NEW), `src/renderer/reference/guide.test.ts` (NEW)

Independent of Task 1 (no shared files). Write the test first (RED), then the module (GREEN).

- [ ] Create `src/renderer/reference/guide.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { GUIDE, filterGuide } from './guide'

describe('GUIDE data integrity', () => {
  it('has unique section ids', () => {
    const ids = GUIDE.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every section has a non-empty title and at least one entry', () => {
    for (const s of GUIDE) {
      expect(s.title.trim().length).toBeGreaterThan(0)
      expect(s.entries.length).toBeGreaterThan(0)
    }
  })

  it('every entry has a non-empty command and desc', () => {
    for (const s of GUIDE) {
      for (const e of s.entries) {
        expect(e.command.trim().length).toBeGreaterThan(0)
        expect(e.desc.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('covers the four expected sections', () => {
    expect(GUIDE.map((s) => s.id).sort()).toEqual(['auth', 'cli', 'deck', 'slash'])
  })
})

describe('filterGuide', () => {
  it('returns all sections for an empty or blank query', () => {
    expect(filterGuide('')).toEqual(GUIDE)
    expect(filterGuide('   ')).toEqual(GUIDE)
  })

  it('matches by command (case-insensitive)', () => {
    const r = filterGuide('CLAUDE MCP')
    expect(r.some((s) => s.entries.some((e) => e.command.toLowerCase().includes('claude mcp')))).toBe(true)
  })

  it('matches by description', () => {
    const r = filterGuide('push-to-talk')
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((s) => s.entries.length > 0)).toBe(true)
  })

  it('matches by example text', () => {
    expect(filterGuide('summarize README').length).toBeGreaterThan(0)
  })

  it('drops sections with zero matching entries (push-to-talk is deck-only)', () => {
    expect(filterGuide('push-to-talk').map((s) => s.id)).toEqual(['deck'])
  })

  it('returns [] when nothing matches', () => {
    expect(filterGuide('zzz-no-such-token-zzz')).toEqual([])
  })

  it('returned sections always carry at least one entry', () => {
    for (const s of filterGuide('claude')) {
      expect(s.entries.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] Create `src/renderer/reference/guide.ts` (full content; curated best-effort):

```ts
/**
 * Curated, hand-maintained reference for the in-app Guide page.
 * Explicitly NOT auto-updated — corrections live in this one file.
 */

export interface GuideEntry {
  /** The command, flag, or shortcut (rendered mono/accent). */
  command: string
  /** Plain-language description of what it does. */
  desc: string
  /** Optional usage example (rendered mono/muted). */
  example?: string
}

export interface GuideSection {
  /** Stable anchor id (used for the jump-nav). */
  id: string
  /** Section heading. */
  title: string
  entries: GuideEntry[]
}

export const GUIDE: GuideSection[] = [
  {
    id: 'cli',
    title: 'Claude CLI commands',
    entries: [
      { command: 'claude', desc: 'Start an interactive session in the current folder.' },
      { command: 'claude "prompt"', desc: 'Start a session with an initial prompt.', example: 'claude "fix the failing test"' },
      { command: 'claude -p, --print "prompt"', desc: 'Print mode: run once, print the result, and exit (non-interactive / scripting).', example: 'claude -p "summarize README.md"' },
      { command: 'claude -c, --continue', desc: 'Continue the most recent conversation in this folder.' },
      { command: 'claude -r, --resume <id>', desc: 'Resume a specific past session by id.', example: 'claude -r 1a2b3c' },
      { command: 'claude config', desc: 'Read or change configuration. Subcommands: get, set, list.', example: 'claude config set -g theme dark' },
      { command: 'claude mcp', desc: 'Manage MCP servers. Subcommands: add, list, remove.', example: 'claude mcp add my-server -- node server.js' },
      { command: 'claude update', desc: 'Update the CLI to the latest version.' },
      { command: 'claude doctor', desc: 'Diagnose installation and configuration problems.' },
      { command: '--version', desc: 'Print the installed CLI version.' },
      { command: '--model <name>', desc: 'Pick the model for this run.', example: 'claude --model opus' },
      { command: '--permission-mode <mode>', desc: 'Set the permission mode: default, acceptEdits, plan, or bypassPermissions.', example: 'claude --permission-mode plan' },
      { command: '--add-dir <path>', desc: 'Give Claude access to an extra directory beyond the working folder.' },
      { command: '--output-format <fmt>', desc: 'Output format: text, json, or stream-json (ClaudeDeck uses stream-json under the hood).' },
      { command: '--allowedTools <list>', desc: 'Pre-allow specific tools without prompting.', example: '--allowedTools "Bash(git*) Read"' },
      { command: '--dangerously-skip-permissions', desc: 'Skip all permission prompts. Use with care — only in trusted, sandboxed contexts.' },
      { command: '--verbose', desc: 'Show detailed turn-by-turn output (events, tool calls).' },
    ],
  },
  {
    id: 'auth',
    title: 'Login / Auth',
    entries: [
      { command: 'Subscription login (Pro / Max)', desc: 'Sign in with your Claude.ai account via browser OAuth — the usual choice, no API key needed.' },
      { command: 'Anthropic Console API key', desc: 'Pay-as-you-go alternative: authenticate with a Console API key instead of a subscription.' },
      { command: 'First-run login', desc: 'On first launch the CLI opens a browser to authenticate; do it once and it remembers you.' },
      { command: '/login', desc: 'Switch account or re-authenticate from inside a session.' },
      { command: '/logout', desc: 'Sign out the current account.' },
      { command: 'claude setup-token', desc: 'Create a long-lived token for non-interactive / CI use.' },
      { command: 'ANTHROPIC_API_KEY', desc: 'Environment variable holding a Console API key; when set, the CLI uses it for auth.', example: 'set ANTHROPIC_API_KEY=sk-ant-...' },
      { command: 'ClaudeDeck live mode', desc: 'Live mode runs the real CLI, so you must already be logged in: run `claude login` (CLI OAuth, not username/password) in a terminal first. An in-app login screen is a future feature.' },
    ],
  },
  {
    id: 'slash',
    title: 'Slash commands (in a session)',
    entries: [
      { command: '/help', desc: 'List available commands and basic usage.' },
      { command: '/clear', desc: 'Clear the conversation and free up context.' },
      { command: '/compact', desc: 'Summarize the conversation so far to reclaim context while keeping the gist.' },
      { command: '/model', desc: 'Switch the active model mid-session.' },
      { command: '/config', desc: 'Open configuration / settings.' },
      { command: '/mcp', desc: 'View and manage connected MCP servers.' },
      { command: '/memory', desc: 'Edit project / user memory (CLAUDE.md and friends).' },
      { command: '/cost', desc: 'Show token usage and cost for the session.' },
      { command: '/doctor', desc: 'Run diagnostics from inside the session.' },
      { command: '/init', desc: 'Generate a CLAUDE.md for the current project.' },
      { command: '/review', desc: 'Request a code review of the current changes.' },
      { command: '/resume', desc: 'Pick a past session to resume.' },
      { command: '/agents', desc: 'Browse and manage subagents.' },
      { command: '/permissions', desc: 'View or change tool permissions.' },
      { command: '/status', desc: 'Show account, model, and connection status.' },
      { command: '/vim', desc: 'Toggle vim key-bindings in the input.' },
      { command: 'Exit', desc: 'Leave the session.', example: 'Ctrl+C twice (or /exit)' },
    ],
  },
  {
    id: 'deck',
    title: 'ClaudeDeck shortcuts',
    entries: [
      { command: 'Ctrl+Shift+V', desc: 'Toggle the hands-free voice assistant on / off.' },
      { command: 'Hold Ctrl+Shift+Space', desc: 'Push-to-talk (local Whisper engine): hold to speak, release to send.' },
      { command: 'Esc', desc: 'Stop the current read-aloud / speech.' },
      { command: 'Enter', desc: 'Send the message.' },
      { command: 'Shift+Enter', desc: 'Insert a newline instead of sending.' },
      { command: '/', desc: 'Open the skills menu from the composer.' },
      { command: 'Voice phrases', desc: 'Spoken navigation when the assistant is on.', example: 'chat · tasks · usage · next tab · read · send · mode · model · guide' },
    ],
  },
]

/**
 * Pure filter: case-insensitive substring over a section's title plus each
 * entry's command/desc/example. Sections with no matching entry are dropped;
 * matching sections keep only their matching entries. Empty/blank query → all.
 */
export function filterGuide(query: string): GuideSection[] {
  const q = query.trim().toLowerCase()
  if (!q) return GUIDE
  const result: GuideSection[] = []
  for (const section of GUIDE) {
    const entries = section.entries.filter(
      (e) =>
        e.command.toLowerCase().includes(q) ||
        e.desc.toLowerCase().includes(q) ||
        (e.example?.toLowerCase().includes(q) ?? false),
    )
    if (entries.length) {
      result.push({ ...section, entries })
    } else if (section.title.toLowerCase().includes(q)) {
      result.push({ ...section })
    }
  }
  return result
}
```

- [ ] Run `npm run test` → all guide tests green.

---

## Task 3 — `views/guide/GuideView.tsx`

**Files:** `src/renderer/views/guide/GuideView.tsx` (NEW). Depends on Task 2 (`filterGuide`, types).

- [ ] Create `src/renderer/views/guide/GuideView.tsx` (no `'use client'` — that's a Next.js
  directive and a no-op in this Vite renderer):

```tsx
import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { filterGuide } from '@/reference/guide'

export default function GuideView(): JSX.Element {
  const [query, setQuery] = useState('')
  const sections = useMemo(() => filterGuide(query), [query])

  const scrollTo = (id: string): void => {
    document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-surface px-4 py-3">
        <h1 className="mb-3 text-lg font-semibold text-fg">Guide</h1>
        <label htmlFor="guide-search" className="sr-only">Search the guide</label>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-fg-muted" aria-hidden="true" />
          <input
            id="guide-search"
            type="text"
            placeholder="Search commands, flags, shortcuts..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-bg py-2 pl-9 pr-3 text-sm text-fg placeholder-fg-muted transition-colors focus:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        {sections.length > 0 && (
          <nav aria-label="Guide sections" className="mt-3 flex flex-wrap gap-2">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(s.id)}
                className="rounded-full border border-border bg-bg px-3 py-1 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {s.title}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sections.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
            <div className="mb-2 text-3xl opacity-30">⊘</div>
            <p className="text-sm text-fg-muted">No entries match your search</p>
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-3 text-xs text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6 px-4 py-4">
            {sections.map((section) => (
              <section
                key={section.id}
                id={`guide-${section.id}`}
                aria-labelledby={`guide-${section.id}-h`}
              >
                <h2
                  id={`guide-${section.id}-h`}
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted"
                >
                  {section.title}
                </h2>
                <dl className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
                  {section.entries.map((entry) => (
                    <div key={entry.command} className="px-3 py-2.5">
                      <dt>
                        <code className="font-mono text-sm text-accent">{entry.command}</code>
                      </dt>
                      <dd className="mt-1 text-sm text-fg-muted">
                        {entry.desc}
                        {entry.example && (
                          <div className="mt-1 font-mono text-xs text-fg-muted/80">{entry.example}</div>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

---

## Task 4 — Wire the Activity into ActivityBar + App (+ optional voice command)

**Files:** `src/renderer/layout/ActivityBar.tsx`, `src/renderer/App.tsx`.
Depends on Task 1 (`'guide'` in `ActivityId`) and Task 3 (`GuideView`).

- [ ] In `ActivityBar.tsx`, add `BookOpen` to the lucide import and a TOP_ITEMS entry after `usage`:

```ts
import {
  MessageSquare,
  FolderGit2,
  KanbanSquare,
  GitCompare,
  Sparkles,
  Gauge,
  BookOpen,
  Settings,
  type LucideIcon,
} from 'lucide-react'
```

```ts
const TOP_ITEMS: ActivityItem[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'sessions', label: 'Sessions', icon: FolderGit2 },
  { id: 'tasks', label: 'Tasks', icon: KanbanSquare },
  { id: 'changes', label: 'Changes', icon: GitCompare },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'usage', label: 'Usage', icon: Gauge },
  { id: 'guide', label: 'Guide', icon: BookOpen },
]
```

- [ ] In `App.tsx`, add the import (next to the other view imports):

```ts
import GuideView from '@/views/guide/GuideView'
```

- [ ] In `App.tsx` `centerView` switch, add a case before `settings`:

```ts
      case 'usage':
        return <UsageView />
      case 'guide':
        return <GuideView />
      case 'settings':
        return <SettingsView />
```

- [ ] In `App.tsx` `commands` array, add a guide voice command after the `usage` one (spec
  optional, chosen IN — consistent with other nav commands; `guide` voice phrase is also
  advertised in the deck section's example):

```ts
    { phrases: ['guide', 'reference', 'manual', 'help page', 'คู่มือ', 'อ้างอิง', 'วิธีใช้'], run: go('guide'), confirm: th ? 'คู่มือ' : 'Guide', label: '“guide” / “คู่มือ”' },
```

- [ ] Run the gate: `npm run typecheck && npm run test && npm run build` — all green.

---

## Parallelization Analysis

- **Files per task (disjoint check):**
  - T1: `fixtures.ts`, `Sidebar.tsx`
  - T2: `reference/guide.ts`, `reference/guide.test.ts`
  - T3: `views/guide/GuideView.tsx`
  - T4: `ActivityBar.tsx`, `App.tsx`
  - No file is touched by two tasks → no write conflicts.
- **Dependencies:** T3 imports from T2; T4 imports `GuideView` (T3) and needs `'guide'` in
  `ActivityId` (T1). T1 and T2 are independent.
- **Batches:**
  - **Batch 1 (parallel):** T1 + T2 (no overlap, no deps).
  - **Batch 2:** T3 (needs T2).
  - **Batch 3:** T4 (needs T1 + T3).
- **Critical path:** T2 → T3 → T4 (length 3). T1 rides along in Batch 1.

Given the plan is small (3 short serial steps + one parallel pair), inline execution is also
reasonable; parallel batching saves little wall-clock here.

## Out of scope (YAGNI)
- Auto-update / live `--help` scraping / web fetch.
- Editing guide content from the UI.
- The in-app login page (this page only *documents* login).
