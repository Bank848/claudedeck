# Composer Control Bar — design spec

**Date:** 2026-06-08
**Status:** approved-for-planning (implement in a fresh session)
**Topic:** Redesign the Composer's bottom control row to look and behave like the
real Claude Code app — a cluster of "pill + popover" controls for model, mode,
effort, a plus menu, and a usage readout.

## Goal

Today the Composer bottom row has only a static "Skills" hint, the `ModelPicker`,
a mic button, and send. Permission mode lives separately in the `StatusBar`, and
there is no effort or usage control. The user wants the row to mirror the Claude
app: model, mode, effort, a `+` menu, and a context/usage readout, all reachable
by mouse, keyboard, and voice.

Reference: user-supplied screenshots of the real Claude app bottom bar
(`Opus 4.8  Medium` on the right; `Auto` chip + `+` + mic on the left; model
dropdown with shortcuts 1–7, Legacy badges and 1M-context variants; a Mode
popover; an Effort slider; a Context-window/Plan-usage popover).

## Scope

**In:**
- A shared `Pill` + `Popover` primitive (extracted from the existing ModelPicker
  dropdown pattern) so every control shares one look, one outside-click/Escape
  close, one focus model.
- Five controls, left→right: **Plus menu**, **Mode pill**, **Model pill**,
  **Effort pill**, **Usage ring**.
- Lifting `permissionMode` from `App`/`StatusBar` down into the Composer.
- Voice commands + ARIA for every control.

**Out (YAGNI):**
- The branch / "Create PR" / diff-stat header seen in the screenshots — separate
  feature, not this bar.
- "Auto mode" as a functional permission mode (the CLI `--permission-mode` enum
  is `default | acceptEdits | bypassPermissions | plan` only).
- Wiring effort to the CLI (no such flag exists — see Effort below).
- Real file attachment behind the `+` (stub now).

## Real vs cosmetic (honesty table)

| Control | Status | Backed by |
|---------|--------|-----------|
| Model pill | ✅ real | CLI `--model` (post-B2 alias mapping) |
| Mode pill | ✅ real | existing `permissionMode` → CLI `--permission-mode` |
| Usage ring | ✅ real-ish | `USAGE` fixture + live `session.tokens` (mock data, but reads real session state) |
| Plus menu | ◑ partial | "Slash commands" + "Add folder" (real Electron dir picker → sets session cwd); "Add files/photos", "Connectors", "Plugins" are disabled stubs |
| Effort pill | ⚠️ cosmetic | persisted UI setting only — **does not affect CLI output**; labelled as such |

## Architecture

### `Pill` + `Popover` primitive (`src/renderer/components/Pill.tsx`)
- `Pill`: a small rounded button (icon? + label + optional chevron), the trigger.
- `Popover`: an absolutely-positioned panel opening **upward** (bottom bar), with:
  - outside-mousedown + Escape to close (one implementation, shared by all),
  - `role` set by caller (`listbox`/`menu`/`dialog`),
  - roving focus: arrow keys move between items, Enter selects, number keys 1–N
    jump-select.
- The existing `ModelPicker` is refactored to consume these primitives instead of
  hand-rolling its own dropdown + outside-click effect.

### Controls (each a thin component over Pill/Popover)

1. **`PlusMenu`** (`+`): a small `menu` popover mirroring the Claude app's `+`
   menu (icons + a `Ctrl+U` hint on the first item). Five rows; build what's
   feasible, stub the rest with a disabled row + `title="Coming soon"`:
   - **Add files or photos** (`Ctrl+U`) — ⚠️ stub (no attachment pipeline yet).
   - **Add folder** — ✅ real: opens an Electron `dialog.showOpenDialog`
     (`properties: ['openDirectory']`) via a new `app:pick-directory` IPC, and
     sets the active session's `cwd` to the chosen path. This also gives the app
     its first real UI for choosing a working directory (the gap behind B1 — the
     cwd fallback stops being the only option). Reducer gains a `setCwd` action;
     the chosen cwd flows into `App.handleSend` as today.
   - **Slash commands** — ✅ real: focuses the composer and inserts `/`, reusing
     the existing slash affordance.
   - **Connectors ›** — ⚠️ stub (no MCP-connector management).
   - **Plugins ›** — ⚠️ stub (no plugin management).
   Submenu carets (`›`) on Connectors/Plugins are rendered but the rows are
   disabled for now. Keyboard: arrow/Enter, Escape closes, focus returns to `+`.

2. **`ModePicker`**: `listbox` of the four CLI permission modes with app-style
   labels + shortcuts:
   - `1` Ask permissions → `default`
   - `2` Accept edits → `acceptEdits`
   - `3` Plan mode → `plan`
   - `4` Bypass permissions → `bypassPermissions`
   Selected row gets a checkmark. Drives the lifted `permissionMode` state
   (already sent to the CLI in `App.handleSend`). The `StatusBar` mode dropdown is
   removed (single source of truth now in the bar); StatusBar keeps Live/Mock.

3. **`ModelPicker`** (enhanced): keep current behavior (provider icons, custom
   "add assistant", checkmark) and add: number shortcuts `1..N`, a muted
   `Legacy` badge and a `1M context` sub-variant rendered from model metadata,
   arrow-key roving focus. Legacy/1M variants are **display metadata only** and
   still map to a CLI-valid `--model` alias (via the existing `toCliModel`);
   variants the CLI can't honor are not offered as functional rows.

4. **`EffortPicker`**: a popover with a discrete slider (`Faster … Smarter`, e.g.
   3–5 stops, default "Medium"). Persists to a new `settings.effort` value. The
   popover header notes it is a display preference that does not change CLI
   behavior today. Pill label shows the current stop ("Medium").

5. **`UsagePill`** (the ring): a `dialog` popover showing **Context window**
   (`session.tokens` / a context limit constant, with %), and **Plan usage** rows
   from the `USAGE` fixture (5-hour, weekly). Reuses the formatting already in
   `UsageView` where practical. Read-only.

### Layout
`ComposerControlBar` replaces the current bottom row inside `Composer.tsx`:
- Left group: `PlusMenu`, mic (existing), `ModePicker`.
- Right group: `ModelPicker`, `EffortPicker`, `UsagePill`, send (existing).
Spacing/typography tuned to the screenshots (small pills, muted text, coral
accent for the active/selected state).

### State & wiring
- `permissionMode` + `setPermissionMode` are threaded `App → ChatView → Composer`
  (or via a small context if prop-drilling gets noisy). `App.handleSend` keeps
  reading `permissionMode` for the CLI; `StatusBar` loses its mode dropdown.
- `settings.effort` added to the settings store (persisted), default "medium".
- Model selection stays as today (`Composer` local `modelId`, seeded from session).

## Accessibility (first-class)
- Every pill is a real `<button>` with `aria-haspopup`, `aria-expanded`, and a
  descriptive `aria-label`; popovers use the right `role` and trap nothing but
  manage roving `tabindex`.
- Number shortcuts (1–N) work when a popover is open; Escape closes; focus
  returns to the trigger.
- New voice commands (TH/EN), dispatched through the existing `voiceCommands`
  longest-match + spoken via `speakSmart` in the user's chosen voice:
  - Mode: "โหมดถาม/ยอมรับแก้ไข/วางแผน/บายพาส" ↔ Ask/Accept/Plan/Bypass
  - Effort: "เอฟฟอร์ต เร็ว/กลาง/ฉลาด" ↔ faster/medium/smarter
  - Model: "โมเดล โอปุส/ซอนเน็ต/ไฮกุ" (reuse provider/model names)
  - Usage: "การใช้งาน" already opens the Usage view; add "หน้าต่างบริบท" to open
    the popover (or keep it to the existing view — decide in plan).
- Selecting a mode/effort/model speaks a short confirmation.

## Testing
- Pure/unit (vitest, existing renderer suite):
  - `modeLabel`/`modeFromVoice` mapping (label ↔ CLI enum) is total and correct.
  - `effort` level ↔ label mapping; persistence round-trips.
  - Model row metadata → `toCliModel` still yields a CLI-valid alias for every
    offered row (extends the B2 guard).
  - Voice command resolution for the new mode/effort phrases (extend
    `voiceCommands.test.ts`).
- The Pill/Popover primitive's keyboard model gets a focused test if practical
  (jsdom) — otherwise covered by manual verify.
- Gate unchanged: typecheck + vitest + build green before each commit.

## Risks / notes
- Prop-drilling `permissionMode`: if it touches too many layers, prefer a tiny
  React context over threading through `ChatView`.
- Effort is cosmetic — must be labelled so users aren't misled. If a future CLI
  effort/thinking flag appears, `EffortPicker` is the single wire-up point.
- Bundle: all new UI is small; no new dependencies (reuse lucide-react + Tailwind).

## Out-of-scope follow-ups (noted, not built)
- Branch + Create-PR + diff-stat header.
- Real `+` attachments (images/files) once the CLI/path supports them.
