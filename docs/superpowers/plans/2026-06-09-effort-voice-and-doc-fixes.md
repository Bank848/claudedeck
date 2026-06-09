# Effort Voice Command + Doc Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three code-review findings on the `--effort` picker + Miku lifecycle branch: (1) fix the broken "Run it" docs after the `.bat` files moved into `launcher/`, (2) make reasoning **effort** settable by voice (blind-first parity with permission-mode and model), (3) de-ambiguate + test `effortFromVoice`.

**Architecture:** Voice control in this app is **data-driven**: `App.tsx` builds a `commands[]` array consumed by `dispatchCommand` (via `handleVoice`). Permission modes are wired by mapping `MODE_OPTIONS` into commands; models by explicit entries — each calls a method on `composerRef` (`ComposerHandle`). Effort already has a working `EffortPicker` + `EFFORT_OPTIONS` (with TH+EN `phrases`) but the picker state lives only inside `Composer` and nothing maps it into `commands[]`. We mirror the proven mode-wiring path: expose `setEffort` on `ComposerHandle`, then map `EFFORT_OPTIONS` into `commands[]`.

**Tech Stack:** Electron + React + TypeScript, Vitest (`npm test`), `tsc --noEmit` (`npm run typecheck`).

**Key design decisions (decided, not open):**
- **Wire effort exactly like permission modes** — `...EFFORT_OPTIONS.map<VoiceCommand>(...)` in `commands[]`, each calling `composerRef.current?.setEffort(o.effort)`. This is the established pattern (mode wiring, `App.tsx:144`), so it needs no new dispatch machinery.
- **`effortFromVoice` stays as a tested utility, mirroring `modeFromVoice`** (which is itself a tested helper not consumed by `App` — App uses `.map`). We keep it for symmetry but **fix the ambiguous return type**: it returned `{ effort?: Effort } | null`, where "no match" (`null`) and "Auto matched" (`{ effort: undefined }`) were two confusable "nothing" states. New return is `EffortOption | null` — `null` is the single "no match" state; a returned option whose `.effort` is `undefined` unambiguously means Auto matched. This resolves the concrete defect (the ambiguity) while preserving parity.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `README.md` | Modify | "Run it" section → point at `ClaudeDeck.exe` + `launcher/*.bat` (the real entry points). |
| `HANDOFF.md` | Modify | Stale `start-dev.bat` reference → `launcher/start-dev.bat`. |
| `src/renderer/settings/effortLevels.ts` | Modify | `effortFromVoice` return type `EffortOption \| null`. |
| `src/renderer/settings/effortLevels.test.ts` | Create | Parity with `permissionModes.test.ts` — covers `effortLabel`, option invariants, `effortFromVoice`. |
| `src/renderer/views/chat/Composer.tsx` | Modify | Expose `setEffort` on `ComposerHandle`. |
| `src/renderer/App.tsx` | Modify | Import `EFFORT_OPTIONS`; map effort voice commands into `commands[]`. |

No two tasks edit the same file → see Parallelization Analysis at the end.

---

## Task 1: Fix the "Run it" docs (#1 🔴)

**Why:** `start.bat` / `start-dev.bat` were removed from the repo root; the launcher (`ClaudeDeck.exe`, `launcher/ClaudeDeck.cs:29`) now runs `launcher/start-dev.bat`, and `launcher/` also holds `start-prod.bat`. `README.md:9-11` still tells users to double-click root `start.bat` — a broken first-run instruction. This is a doc-only change (no test).

**Files:**
- Modify: `README.md:9-11`
- Modify: `HANDOFF.md:11`

- [ ] **Step 1: Rewrite the README "Run it" lines**

In `README.md`, replace these two paragraphs:

```markdown
Double-click **`start.bat`** (Windows). On first run it installs dependencies, builds, and launches the app. A coral splash shows while it boots.

For UI tuning with hot reload, double-click **`start-dev.bat`**.
```

with:

```markdown
Double-click **`ClaudeDeck.exe`** (Windows). On first run it installs dependencies and launches the app with no console window. A coral splash shows while it boots.

Power-user batch files live in `launcher/`: **`launcher/start-dev.bat`** (hot-reload dev) and **`launcher/start-prod.bat`** (production build + launch).
```

- [ ] **Step 2: Fix the HANDOFF.md reference**

In `HANDOFF.md`, change line 11 from:

```markdown
electron-vite + React + TS + Tailwind v3.4. `npm run dev` (or `start-dev.bat`) to run;
```

to:

```markdown
electron-vite + React + TS + Tailwind v3.4. `npm run dev` (or `launcher/start-dev.bat`) to run;
```

- [ ] **Step 3: Verify no stale root-level `.bat` references remain**

Run: `git grep -nE '(^|[^/])start(-dev)?\.bat' -- README.md HANDOFF.md`
Expected: no matches that point at a **root** `start.bat` / `start-dev.bat` (every remaining hit must be prefixed `launcher/`). If a hit has no `launcher/` prefix, fix it.

- [ ] **Step 4: Commit**

```bash
git add README.md HANDOFF.md
git commit -m "docs: point run instructions at ClaudeDeck.exe + launcher/ (start.bat moved)"
```

---

## Task 2: De-ambiguate + test `effortFromVoice` (#3 🟠)

**Why:** `effortFromVoice` is the symmetric sibling of `modeFromVoice` but returns `{ effort?: Effort } | null`, conflating "no match" with "Auto matched". `effortLevels.ts` also has no test, unlike `permissionModes.ts`. Fix the type, then add the missing test for parity.

**Files:**
- Modify: `src/renderer/settings/effortLevels.ts:27-41`
- Create: `src/renderer/settings/effortLevels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/settings/effortLevels.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { EFFORT_OPTIONS, effortLabel, effortFromVoice } from './effortLevels'

describe('effortLevels', () => {
  it('effortLabel returns the option label, Auto for undefined', () => {
    expect(effortLabel(undefined)).toBe('Auto')
    expect(effortLabel('high')).toBe('High')
    expect(effortLabel('max')).toBe('Max')
  })

  it('every option has a unique shortcut and non-empty phrases', () => {
    const shortcuts = EFFORT_OPTIONS.map((o) => o.shortcut)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    for (const o of EFFORT_OPTIONS) expect(o.phrases.length).toBeGreaterThan(0)
  })

  it('effortFromVoice matches TH + EN phrases, longest phrase wins', () => {
    expect(effortFromVoice('high effort please')?.effort).toBe('high')
    expect(effortFromVoice('เอฟฟอร์ตสูงสุด')?.effort).toBe('max')
    // 'extra high effort' also contains 'high effort' — the longer phrase wins.
    expect(effortFromVoice('extra high effort')?.effort).toBe('xhigh')
    // Auto is a real match → an option is returned whose effort is undefined (NOT null).
    const auto = effortFromVoice('ค่าเริ่มต้น')
    expect(auto).not.toBeNull()
    expect(auto?.effort).toBeUndefined()
    // No phrase matched → null (the single unambiguous "nothing" state).
    expect(effortFromVoice('สวัสดี')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to confirm it runs (coverage-first, not a strict RED)**

Run: `npx vitest run src/renderer/settings/effortLevels.test.ts`
Expected: the file executes. Note: the old `{ effort?: Effort }` return also exposes `.effort`, so most assertions would already pass — this task's value is **adding missing coverage + tightening the type**, not a literal RED→GREEN. The behavioral lock is that after Step 3 the return is `EffortOption | null` (one "nothing" state) and these tests still pass. If you want a true RED, temporarily assert `effortFromVoice('สวัสดี')` returns `null` AND that a match returns an object identity from `EFFORT_OPTIONS` (`expect(EFFORT_OPTIONS).toContain(effortFromVoice('max effort')!)`) — the latter fails on the old code (which built a fresh `{ effort }` object) and passes after Step 3.

- [ ] **Step 3: Change `effortFromVoice` to return the matched option**

In `src/renderer/settings/effortLevels.ts`, replace the existing function (lines 27-41):

```typescript
/** Longest matching phrase wins (mirrors modeFromVoice). Returns the match, or null. */
export function effortFromVoice(text: string): { effort?: Effort } | null {
  const t = text.toLowerCase()
  let best: { effort?: Effort } | null = null
  let len = 0
  for (const o of EFFORT_OPTIONS) {
    for (const p of o.phrases) {
      if (t.includes(p) && p.length > len) {
        best = { effort: o.effort }
        len = p.length
      }
    }
  }
  return best
}
```

with:

```typescript
/**
 * Longest matching voice phrase wins (mirrors {@link modeFromVoice}). Returns the
 * whole matched option so the caller reads `.effort` — which is `undefined` for the
 * Auto option. `null` is the single "no phrase matched" state, replacing the old
 * `{ effort: undefined }` that collided with a real Auto match.
 */
export function effortFromVoice(text: string): EffortOption | null {
  const t = text.toLowerCase()
  let best: EffortOption | null = null
  let len = 0
  for (const o of EFFORT_OPTIONS) {
    for (const p of o.phrases) {
      if (t.includes(p) && p.length > len) {
        best = o
        len = p.length
      }
    }
  }
  return best
}
```

(`EffortOption` is already exported from this file, so no new import is needed. The unused `Effort` import stays — it is still used by `effortLabel`'s parameter and the `EffortOption.effort` field.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/settings/effortLevels.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms no other caller depended on the old `{ effort?: Effort }` shape — there are none today).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/settings/effortLevels.ts src/renderer/settings/effortLevels.test.ts
git commit -m "refactor(effort): effortFromVoice returns EffortOption|null (no null/undefined ambiguity) + tests"
```

---

## Task 3: Expose `setEffort` on `ComposerHandle` (#2 🟠, part 1)

**Why:** Voice commands set model via `composerRef.current?.setModel(...)`. The effort selection lives in `Composer` local state (`const [effort, setEffort] = useState<Effort | undefined>(undefined)`, `Composer.tsx:50`) but `ComposerHandle` only exposes `{ submit, setModel }` (`Composer.tsx:80`), so voice can't reach it. Expose the existing `setEffort` state setter on the handle.

**Files:**
- Modify: `src/renderer/views/chat/Composer.tsx:14-19` (interface), `Composer.tsx:80` (handle)

> No standalone unit test — `ComposerHandle` is a React imperative handle exercised by Task 4's wiring; correctness is enforced by `npm run typecheck` (the new method must exist for `App.tsx` to compile) and the full suite. TDD's RED here is the typecheck failure introduced in Task 4 if this method is missing.

- [ ] **Step 1: Add `setEffort` to the `ComposerHandle` interface**

In `src/renderer/views/chat/Composer.tsx`, change the interface (lines 14-19):

```typescript
export interface ComposerHandle {
  /** Submit the current text programmatically (used by the "ส่ง" voice command). */
  submit: () => void
  /** Set the model by id (used by the "โมเดล …" voice command). */
  setModel: (id: string) => void
}
```

to:

```typescript
export interface ComposerHandle {
  /** Submit the current text programmatically (used by the "ส่ง" voice command). */
  submit: () => void
  /** Set the model by id (used by the "โมเดล …" voice command). */
  setModel: (id: string) => void
  /** Set the reasoning effort (used by the "เอฟฟอร์ต …" voice command); undefined = Auto. */
  setEffort: (effort?: Effort) => void
}
```

(`Effort` is already imported at `Composer.tsx:12`.)

- [ ] **Step 2: Expose the state setter through `useImperativeHandle`**

In `src/renderer/views/chat/Composer.tsx:80`, change:

```typescript
  useImperativeHandle(ref, () => ({ submit, setModel: setModelId }))
```

to:

```typescript
  useImperativeHandle(ref, () => ({ submit, setModel: setModelId, setEffort }))
```

(`setEffort` is the existing `useState` setter from line 50; React state setters accept `Effort | undefined`, matching the handle signature.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`App.tsx` does not yet call `setEffort`, so this is green on its own.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/views/chat/Composer.tsx
git commit -m "feat(composer): expose setEffort on ComposerHandle for voice control"
```

---

## Task 4: Map effort into the voice `commands[]` (#2 🟠, part 2)

**Why:** This is the actual wiring — mirrors the `MODE_OPTIONS.map<VoiceCommand>` block (`App.tsx:144-149`). Depends on Task 3 (`ComposerHandle.setEffort` must exist to compile).

**Files:**
- Modify: `src/renderer/App.tsx:29` (import), `App.tsx:150-154` (commands)

- [ ] **Step 1: Import `EFFORT_OPTIONS`**

In `src/renderer/App.tsx`, just below the existing mode import (line 29):

```typescript
import { MODE_OPTIONS } from '@/settings/permissionModes'
```

add:

```typescript
import { EFFORT_OPTIONS } from '@/settings/effortLevels'
```

- [ ] **Step 2: Map effort options into `commands[]`**

In `src/renderer/App.tsx`, immediately after the model voice commands (the three `model …` entries ending at `App.tsx:153`, right before the closing `]` of `commands`), insert:

```typescript
    // Reasoning effort by spoken level (TH+EN) → drives the Composer's local effort.
    ...EFFORT_OPTIONS.map<VoiceCommand>((o) => ({
      phrases: o.phrases,
      run: () => composerRef.current?.setEffort(o.effort),
      confirm: th ? `เอฟฟอร์ต ${o.label}` : `Effort ${o.label}`,
      label: `“effort ${o.label}”`,
    })),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (proves `setEffort` from Task 3 is reachable and typed).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all pass, including `voiceCommands.test.ts` (no phrase-collision regression) and the new `effortLevels.test.ts`. The effort phrases are all suffixed/prefixed (`… effort`, `เอฟฟอร์ต…`, `อัตโนมัติ`, `ค่าเริ่มต้น`, `สูงพิเศษ`, `ระดับ…`) so they do not collide with existing single-word commands.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(voice): set reasoning effort by voice (blind-first parity with mode + model)"
```

---

## Parallelization Analysis

Files touched per task are **disjoint** except for the one type dependency:

| Task | Files | Depends on |
|------|-------|-----------|
| 1 (docs) | `README.md`, `HANDOFF.md` | — |
| 2 (effortFromVoice) | `effortLevels.ts`, `effortLevels.test.ts` | — |
| 3 (ComposerHandle) | `Composer.tsx` | — |
| 4 (App wiring) | `App.tsx` | **Task 3** (needs `ComposerHandle.setEffort` to typecheck) |

- **Batch 1 (parallel):** Tasks **1, 2, 3** — no shared files, no ordering deps. Run concurrently.
- **Batch 2:** Task **4** — must follow Task 3 (compile-time dependency on the new handle method). Task 4 is independent of Tasks 1 and 2.
- **Critical path:** Task 3 → Task 4 (two steps). Everything else is off the critical path.

No task edits a file another task edits → no worktree isolation needed.

## Final Verification (after all tasks)

- [ ] `npm run typecheck` → clean
- [ ] `npm test` → all green (was 13/13 on `claude.test.ts`; now also `effortLevels.test.ts` + unchanged `permissionModes.test.ts` / `voiceCommands.test.ts`)
- [ ] Manual smoke (optional, requires app run): enable voice commands, say "high effort" / "เอฟฟอร์ตสูงสุด" → the EffortPicker pill label updates and the spoken confirm ("Effort High" / "เอฟฟอร์ต Max") is read back.
