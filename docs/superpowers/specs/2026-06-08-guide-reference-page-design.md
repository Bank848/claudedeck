# ClaudeDeck — Guide / Reference Page (design)

**Date:** 2026-06-08
**Status:** Approved (brainstorm). Next: `/plan-pro` → implement.

## Goal

An in-app **static "wiki / cheatsheet" page** the user can open to read *what commands
exist and how to use them*. The user doesn't memorise the `claude` CLI or the normal login
flow — this page is a reference grouped into sections, item by item, easy to skim.

**Explicitly NOT auto-updating** (cost-conscious decision). Content is curated in the repo
and edited by hand in one data file. No live `--help` scraping, no web fetch.

## Approach (chosen: A)

**A. Typed data module + GuideView** — content as a typed array; view renders grouped
sections with search + category jump-nav. Mirrors the existing `SkillsBrowser` pattern
(search box, grouped layout, empty state), so it fits the codebase and is accessible.

Rejected: (B) single markdown + react-markdown — weaker search / section-jump, harder
layout control; (C) Skills-style cards — command references read worse as cards than as lists.

## Design

### 1. New Activity `'guide'`
- Add `'guide'` to `ActivityId` (`src/renderer/mock/fixtures.ts`).
- `ActivityBar.tsx`: new item with lucide `BookOpen`. Placement: top group after `usage`
  (label "Guide").

### 2. Data module — `src/renderer/reference/guide.ts`
```ts
export interface GuideEntry { command: string; desc: string; example?: string }
export interface GuideSection { id: string; title: string; entries: GuideEntry[] }
export const GUIDE: GuideSection[]
/** Pure filter helper (lowercased substring over command+desc+example+title). */
export function filterGuide(query: string): GuideSection[]
```
Four sections:
- **`cli` — Claude CLI commands:** `claude`, `claude "prompt"`, `-p/--print`,
  `-c/--continue`, `-r/--resume <id>`, `claude config` (`get/set/list`), `claude mcp`
  (`add/list/remove`), `claude update`, `claude doctor`, `--version`, plus key flags
  `--model`, `--permission-mode`, `--add-dir`, `--output-format`, `--allowedTools`,
  `--dangerously-skip-permissions`, `--verbose`.
- **`auth` — Login / Auth:** subscription OAuth (Pro/Max) vs Anthropic Console API key;
  first-run login flow; `/login`, `/logout`; `claude setup-token` (long-lived token);
  `ANTHROPIC_API_KEY` env var. Note ClaudeDeck live mode needs `claude login` in a terminal
  (CLI OAuth, not user/pass) — ties to the deferred in-app login feature.
- **`slash` — Slash commands (interactive session):** `/help`, `/clear`, `/compact`,
  `/model`, `/config`, `/mcp`, `/memory`, `/cost`, `/doctor`, `/init`, `/review`,
  `/resume`, `/agents`, `/permissions`, `/status`, `/vim`, exit (Ctrl+C twice).
- **`deck` — ClaudeDeck shortcuts:** Ctrl+Shift+V (toggle voice assistant), hold
  Ctrl+Shift+Space (push-to-talk, local engine), Esc (stop speech), Enter / Shift+Enter
  (send / newline), `/` (skills), and the spoken voice phrases (chat / tasks / usage /
  next tab / read / send / mode / model …).

Content is **curated best-effort** against the current Claude CLI; corrections live in this
one file.

### 3. View — `src/renderer/views/guide/GuideView.tsx`
- Header: `<h1>Guide</h1>` + search input (filters all fields via `filterGuide`).
- Body: grouped sections; each section a `<section>` with `<h2>` + a list of entries.
  Each entry: `<code>` command (mono, accent), `desc` text, optional `example` (mono, muted).
- Left (or sticky-top) **category nav** `<nav aria-label="Guide sections">` — clicking jumps
  to the section anchor (`id`). Keep simple; scroll-into-view on click.
- Empty state mirrors `SkillsBrowser` ("No entries match" + Clear).

### 4. Wire — `App.tsx`
- `import GuideView`; add `case 'guide': return <GuideView />` to the `centerView` switch.

### 5. Accessibility
- Heading order `h1 → h2`; entries as a description list (`<dl><dt><dd>`) or semantic list.
- Search input has a visible-or-`sr-only` label; category nav is a labelled `<nav>`.
- All interactive elements keep `focus-visible:ring-2 focus-visible:ring-accent`.
- Reuse token classes (`bg-surface`, `text-fg/fg-muted`, `text-accent`, `border-border`).

### 6. Tests — `src/renderer/reference/guide.test.ts`
- Data integrity: section `id`s unique; every section has ≥1 entry; every entry has
  non-empty `command` + `desc`.
- `filterGuide`: returns matching subset (by command, by desc, case-insensitive); empty
  query returns all; no-match returns `[]`; sections with zero matches are dropped.

## Out of scope (YAGNI)
- Auto-update / live `--help` scraping / web fetch.
- Editing content from the UI (it's read-only).
- The in-app login page (separate deferred feature; this page only *documents* login).

## Voice command (optional, nice-to-have)
Add a `guide`/`คู่มือ`/`help page` phrase routing to `go('guide')` in `App.tsx` commands —
consistent with the other nav voice commands. Decide during planning.
