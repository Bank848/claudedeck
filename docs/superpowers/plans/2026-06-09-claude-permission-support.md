# Plan — Full claude CLI permission support in ClaudeDeck

> Planner: `/plan-pro` (writing-plans substance + spawned review + parallelization analysis).
> Output: single `.md` (token-saving, per user global pref). Approved scope: **all 5 phases incl. stream-json**.

## Goal

Make ClaudeDeck expose the full permission surface of the real `claude` CLI (v2.1.169), in 5
incremental phases ordered by payoff/ease:

1. **Enum completion** — add the two missing `--permission-mode` values `auto` + `dontAsk`.
2. **Tool allow/deny** — `--allowedTools` / `--disallowedTools` rule lists + a UI editor.
3. **Directory scope** — `--add-dir` multi-folder access.
4. **Persistent Permission Settings** — generate a `permissions{}` settings object, pass via
   `--settings <json>` (+ optional `--setting-sources`).
5. **Interactive permissions** — move `startTurn` to `--input-format stream-json` and handle the
   `control_request` / `control_response` (`can_use_tool`) protocol so the UI can pop an
   Allow/Deny dialog mid-turn.

## Architecture / invariants (must hold across every phase)

- **No user text ever reaches shell argv.** Today the prompt is fed over stdin with
  `--input-format text`. Phase 5 keeps the prompt off argv (now as a stream-json message on
  stdin). Every new argv token added (tool rules, dirs, settings JSON) is a fixed flag or a
  caller-supplied value passed as a **separate argv token** — never concatenated into a shell
  string. Windows still spawns via `cmd.exe /c <bin> ...args` (claude.ts:122); because args are
  passed as an array and the prompt is on stdin, cmd never parses untrusted text.
- **Type duplication is intentional but must stay in sync.** `PermissionMode` is declared in
  THREE places: `electron/claude.ts:5`, `src/renderer/cli/types.ts:80`, and inline in
  `electron/preload.ts:77`. Any enum change touches all three. Two compile-time guards already
  exist and will fail loudly if you miss a spot: `PERMISSION_LABELS` in `StatusBar.tsx:17` is
  `Record<PermissionMode,string>` (total), and `permissionModes.test.ts` asserts the exact mode
  set.
- **TDD.** Every phase: write/extend the failing test first, then implement. Keep `npm test`
  (vitest) green before moving on.

## Tech stack

Electron main (`electron/*.ts`) + React renderer (`src/renderer/**`), TypeScript, vitest.
Process bridge: `claude:start` IPC → `startTurn` → `spawn`. No new deps.

---

## File Structure

```
electron/
  claude.ts              # MODIFY  enum, StartTurnArgs fields, buildArgs, startTurn (P5)
  claude.test.ts         # MODIFY  buildArgs cases for new flags
  preload.ts             # MODIFY  inline startTurn arg type + P5 permission IPC
  main.ts                # MODIFY (P5) register claude:permission-response handler (near claude:start ~373)
  permissions.ts         # ADD (P4) buildSettingsJson()
  permissions.test.ts    # ADD (P4)
  permissionProtocol.ts  # ADD (P5) framing: user msg + parse control_request + build response
  permissionProtocol.test.ts # ADD (P5)
src/renderer/
  cli/types.ts           # MODIFY  PermissionMode, StartTurnRequest fields, control types (P5)
  cli/claudeClient.ts    # MODIFY (P5) respondPermission() + permission channel in TurnHandlers/subscribe
  settings/
    permissionModes.ts   # MODIFY  MODE_OPTIONS (P1)
    permissionModes.test.ts # MODIFY (P1)
    permissionRules.ts   # ADD (P2/P4) allow/deny/ask state model + serialize
    permissionRules.test.ts # ADD
  layout/StatusBar.tsx   # MODIFY  PERMISSION_LABELS total map (P1)
  components/controls/
    ModePicker.tsx        # MODIFY (P1, only if shortcut cap matters)
    ToolRulesEditor.tsx   # ADD (P2)
    DirScopeEditor.tsx    # ADD (P3)
  views/settings/
    PermissionSettings.tsx # ADD (P4) persistent allow/deny/ask + dirs page
  views/chat/PermissionPrompt.tsx # ADD (P5) Allow/Deny dialog
  App.tsx                # MODIFY  state + wire-through each phase
  reference/guide.ts     # MODIFY  doc the new flags (P1/P2)
```

---

# Phase 1 — Permission mode enum (`auto` + `dontAsk`)

Pure pass-through. CLI `--permission-mode` choices (verified v2.1.169):
`acceptEdits | auto | bypassPermissions | default | dontAsk | plan`.

### Task 1.1 — Extend the type in all three declarations

- [ ] `electron/claude.ts:5` →
  ```ts
  export type PermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default' | 'auto' | 'dontAsk'
  ```
- [ ] `src/renderer/cli/types.ts:80` → identical union.
- [ ] `electron/preload.ts:77` → inline union in `startTurn` arg type updated to match.

### Task 1.2 — Make the totality guards pass (RED → GREEN)

- [ ] `src/renderer/layout/StatusBar.tsx:17` add keys:
  ```ts
  const PERMISSION_LABELS: Record<PermissionMode, string> = {
    plan: 'Plan (read-only)',
    acceptEdits: 'Accept edits',
    bypassPermissions: 'Bypass',
    default: 'Default',
    auto: 'Auto',
    dontAsk: "Don't ask",
  }
  ```
- [ ] `src/renderer/settings/permissionModes.test.ts` — update **all three** hardcoded
  assertions first (this is the failing-test step). The reviewer confirmed line 9 also asserts the
  shortcut set and the test title says "four ... modes":
  ```ts
  // test title: rename "four CLI permission modes" → "six ..."
  // sorted modes list assertion
  expect(modes).toEqual(['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan'])
  // shortcut set assertion (line ~9) — was [1,2,3,4]
  expect(MODE_OPTIONS.map((o) => o.shortcut).sort()).toEqual([1, 2, 3, 4, 5, 6])
  // modeLabel totality array
  const all: PermissionMode[] = ['plan', 'acceptEdits', 'bypassPermissions', 'default', 'auto', 'dontAsk']
  ```

### Task 1.3 — Add the two options to the picker model

- [ ] `src/renderer/settings/permissionModes.ts` MODE_OPTIONS — append (shortcuts 5,6):
  ```ts
  { mode: 'auto', label: 'Auto', shortcut: 5, phrases: ['auto mode', 'automatic', 'โหมดอัตโนมัติ', 'อัตโนมัติ'] },
  { mode: 'dontAsk', label: "Don't ask", shortcut: 6, phrases: ["don't ask", 'dont ask', 'no ask', 'ไม่ต้องถาม', 'ไม่ถาม'] },
  ```
  Also fix the now-stale JSDoc on `ModeOption.shortcut` (permissionModes.ts:6/7): "(1..4)" → "(1..6)".
  Note: `ModePicker.tsx:31` already matches `^[1-9]$` so shortcuts 5/6 work with no change.
  `modeFromVoice` is data-driven → picks them up automatically.
- [ ] `src/renderer/reference/guide.ts:39` — update the `--permission-mode` desc string to list
  all six modes.

### Task 1.4 — Lock pass-through in buildArgs test

- [ ] `electron/claude.test.ts` add:
  ```ts
  it('passes auto and dontAsk through --permission-mode unchanged', () => {
    for (const m of ['auto', 'dontAsk'] as const) {
      const args = buildArgs({ ...base, permissionMode: m })
      const i = args.indexOf('--permission-mode')
      expect(args[i + 1]).toBe(m)
    }
  })
  ```

**Phase 1 done when:** `npm test` green, all six modes selectable in ModePicker + voice + StatusBar label.

---

# Phase 2 — Tool allow/deny rules

CLI: `--allowedTools <tools...>` / `--disallowedTools <tools...>` (variadic; each rule one token,
e.g. `Bash(git *)`, `Edit`, `mcp__renpy__*`).

### Task 2.1 — Sanitizer (RED first)

- [ ] `src/renderer/settings/permissionRules.ts` ADD:
  ```ts
  /** Drop empty/whitespace-only rules; trim each. Order preserved, dups removed. */
  export function cleanRules(rules: readonly string[] | undefined): string[] {
    if (!rules) return []
    const out: string[] = []
    for (const r of rules) {
      const t = r.trim()
      if (t && !out.includes(t)) out.push(t)
    }
    return out
  }
  ```
- [ ] `src/renderer/settings/permissionRules.test.ts` — trims, drops empties, dedupes, preserves order.

> `electron/claude.ts` re-exports/duplicates this helper to avoid a renderer→main import. Add the
> same `cleanRules` (copy) in claude.ts and unit-test it in claude.test.ts, OR move it to a shared
> `electron`-importable module. **Decision:** copy into claude.ts (main has no `@/` alias to renderer);
> keep both tested. (Reviewer: flag if a shared module is cleaner given build setup.)

### Task 2.2 — Thread fields through the contracts

- [ ] `electron/claude.ts` `StartTurnArgs` add:
  ```ts
  allowedTools?: string[]
  disallowedTools?: string[]
  ```
- [ ] `src/renderer/cli/types.ts` `StartTurnRequest` — same two fields.
- [ ] `electron/preload.ts:71-79` inline arg type — same two fields.

### Task 2.3 — Emit flags (test first)

- [ ] `electron/claude.test.ts`:
  ```ts
  it('emits --allowedTools / --disallowedTools as separate tokens, skips when empty', () => {
    expect(buildArgs(base)).not.toContain('--allowedTools')
    const a = buildArgs({ ...base, allowedTools: ['Bash(git *)', 'Edit', '  '], disallowedTools: ['WebFetch'] })
    const ai = a.indexOf('--allowedTools')
    expect(ai).toBeGreaterThanOrEqual(0)
    expect(a[ai + 1]).toBe('Bash(git *)')   // one rule = one argv token (no shell parse)
    expect(a[ai + 2]).toBe('Edit')
    expect(a).not.toContain('  ')            // empty rule dropped
    expect(a).toContain('--disallowedTools')
  })
  ```
- [ ] `electron/claude.ts` `buildArgs` — append after `--permission-mode` block:
  ```ts
  const allow = cleanRules(a.allowedTools)
  const deny = cleanRules(a.disallowedTools)
  ...
  ...(allow.length ? ['--allowedTools', ...allow] : []),
  ...(deny.length ? ['--disallowedTools', ...deny] : []),
  ```

### Task 2.4 — UI: ToolRulesEditor + wire-through

- [ ] `src/renderer/components/controls/ToolRulesEditor.tsx` ADD — two labelled lists (Allow /
  Deny), each: add-rule input + removable chips. Free-text (rules are patterns, not a fixed
  enum). Accessible: `<label>`, `role="list"`, keyboard-removable chips. Props:
  `{ allowed: string[]; disallowed: string[]; onChange(next: {allowed,disallowed}): void }`.
- [ ] `src/renderer/App.tsx` — add `useState<string[]>([])` for `allowedTools`/`disallowedTools`,
  include them in the `startTurn` payload (App.tsx:439), render `ToolRulesEditor` in the
  controls/settings area.
- [ ] `src/renderer/reference/guide.ts:42` — the `--allowedTools` line already exists; update it
  and add `--disallowedTools` / `--add-dir` (P3) / `--settings` (P4) doc entries.

**Phase 2 done when:** rules round-trip to argv as discrete tokens; injection test still green;
UI edits the lists.

---

# Phase 3 — Directory scope (`--add-dir`)

### Task 3.1 — Field + flag (test first)

- [ ] `electron/claude.test.ts`:
  ```ts
  it('emits each additional dir as an --add-dir token, skips empties', () => {
    const a = buildArgs({ ...base, additionalDirs: ['D:/lib', '  ', 'D:/shared'] })
    const i = a.indexOf('--add-dir')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(a.slice(i + 1, i + 3)).toEqual(['D:/lib', 'D:/shared'])
  })
  ```
- [ ] `electron/claude.ts` — `StartTurnArgs.additionalDirs?: string[]`; in `buildArgs`:
  ```ts
  const dirs = cleanRules(a.additionalDirs)
  ...(dirs.length ? ['--add-dir', ...dirs] : []),
  ```
- [ ] `src/renderer/cli/types.ts` + `electron/preload.ts` — add `additionalDirs?: string[]`.

### Task 3.2 — UI: DirScopeEditor

- [ ] `src/renderer/components/controls/DirScopeEditor.tsx` ADD — list of dirs + "Add folder"
  button calling existing `window.claudedeck.app.pickDirectory()` (preload.ts:24), removable chips.
- [ ] `src/renderer/App.tsx` — state + include in startTurn payload + render.

**Phase 3 done when:** picked dirs appear as `--add-dir` tokens; empties dropped.

---

# Phase 4 — Persistent Permission Settings via `--settings`

CLI: `--settings <file-or-json>` accepts a **JSON string directly** (no temp file needed) and
`--setting-sources <user,project,local>`. Settings schema:
`permissions: { allow[], deny[], ask[], defaultMode, additionalDirectories[] }`.

> Relationship to P2/P3: `--allowedTools`/`--add-dir` are *per-turn* ephemeral; `--settings`
> is the *persistent* layer the user curates once. They compose (CLI merges). Phase 4 is the
> "save my rules" home; P2/P3 editors can offer a "Save to settings" action that writes here.

### Task 4.1 — buildSettingsJson (test first)

- [ ] `electron/permissions.ts` ADD:
  ```ts
  export interface PermissionSettings {
    allow?: string[]; deny?: string[]; ask?: string[]
    defaultMode?: string; additionalDirectories?: string[]
  }
  /** Serialize to the `--settings` JSON string. Returns undefined when nothing is set
   *  (so the flag is omitted and the CLI uses its own config). */
  export function buildSettingsJson(p?: PermissionSettings): string | undefined {
    if (!p) return undefined
    const permissions: Record<string, unknown> = {}
    for (const k of ['allow', 'deny', 'ask', 'additionalDirectories'] as const) {
      const v = cleanRules(p[k]); if (v.length) permissions[k] = v
    }
    if (p.defaultMode) permissions.defaultMode = p.defaultMode
    if (Object.keys(permissions).length === 0) return undefined
    return JSON.stringify({ permissions })
  }
  ```
- [ ] `electron/permissions.test.ts` — empty→undefined, fields populate, JSON parses,
  `JSON.parse(out).permissions.allow` correct.

### Task 4.2 — Wire flag (test first)

- [ ] `electron/claude.test.ts` — settings JSON appears as a single `--settings` token; omitted when empty.
- [ ] `electron/claude.ts` — `StartTurnArgs.settings?: PermissionSettings` (+ optional
  `settingSources?: string`); in `buildArgs`:
  ```ts
  const settingsJson = buildSettingsJson(a.settings)
  ...(settingsJson ? ['--settings', settingsJson] : []),
  // gate on settingSources ALONE — it selects which config layers load, independent of defaultMode
  ...(a.settingSources ? ['--setting-sources', a.settingSources] : []),
  ```
  (settingsJson is ONE argv token — JSON never hits a shell.)
- [ ] `src/renderer/cli/types.ts` + `electron/preload.ts` — mirror the `settings` field type.

### Task 4.3 — Persistent UI + storage

- [ ] `src/renderer/views/settings/PermissionSettings.tsx` ADD — editors for allow/deny/ask +
  defaultMode (reuse MODE_OPTIONS) + additionalDirectories. Persist to `localStorage`
  (key `claudedeck.permissions`) via a small `loadPermissions()/savePermissions()` in
  `permissionRules.ts`; unit-test the load/save round-trip (guard against malformed JSON).
- [ ] `src/renderer/App.tsx` — load persisted settings on mount, include in startTurn payload,
  route to the page.

**Phase 4 done when:** curated rules persist across restarts and reach the CLI as `--settings`.

---

# Phase 5 — Interactive permissions (stream-json + control protocol)

Moves `startTurn` from `--input-format text` to `--input-format stream-json` so the CLI can send
`control_request` (`can_use_tool`) and receive a `control_response` over the still-open stdin.
`--permission-prompt-tool` was removed in v2.1.169 — the control protocol replaces it.

> ⚠️ The exact control_request/response JSON shape must be confirmed against the installed CLI
> before coding the handler (Task 5.0). Do not hardcode a guessed schema.

### Task 5.0 — Spike RESULTS (captured 2026-06-10 against CLI v2.1.169) ✅

**Enabling flags:** `--input-format stream-json --output-format stream-json --verbose
--permission-prompt-tool stdio` (the hidden `--permission-prompt-tool stdio` is the switch —
stream-json alone does NOT delegate; without it `default` mode auto-DENIES non-allowlisted tools
in headless `-p`).

**Wire format (confirmed by a Node driver that completed a full allow handshake — file written):**
- Init (client→CLI, send first): `{"type":"control_request","request_id":"init-1","request":{"subtype":"initialize"}}`
- can_use_tool (CLI→client): `{"type":"control_request","request_id":"<uuid>","request":{"subtype":"can_use_tool","tool_name":"Write","display_name":"Write","input":{...},"description":"...","permission_suggestions":[{"type":"setMode","mode":"acceptEdits","destination":"session"}],"tool_use_id":"toolu_..."}}`
- Response (client→CLI): `{"type":"control_response","response":{"subtype":"success","request_id":"<uuid>","response":{"behavior":"allow","updatedInput":{...}}}}` — deny: `{"behavior":"deny","message":"..."}`
- User msg envelope: `{"type":"user","message":{"role":"user","content":"<prompt string>"}}` (string content works).

**Lifecycle:** `result` event fires then the process EXITS on its own even with stdin held open;
a no-permission turn also completes + exits cleanly (no hang). stdin must stay open *during* the
turn to answer can_use_tool. Strategy: end stdin on the `result` event (also on cancel). The CLI's
`control_response` to `initialize` (commands list) and any `control_request` must be filtered out
of the normal `claude:event` stream.

### Task 5.0 (original plan) — Spike: capture the real wire format (no production code)

- [ ] Run the CLI in stream-json mode against a prompt that forces a tool permission (e.g. a Bash
  command under `--permission-mode default`) and record the exact JSON lines. Run under **bash/WSL
  or a PowerShell here-string** (Windows cmd won't preserve the single-quoted JSON):
  ```
  echo '{"type":"user","message":{"role":"user","content":"run: git status"}}' \
    | claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode default
  ```
- [ ] Document in this plan (or a scratch note) the real field names for: the user message
  envelope, the `control_request` (request id, tool name, input), and the expected
  `control_response` (allow/deny, optional updated input/permissions). **Adjust Tasks 5.1–5.4 to
  the observed schema before implementing.**
- [ ] **CRITICAL — determine the end-of-input / turn-completion signal.** With `--input-format
  stream-json`, the CLI treats stdin as a *message stream*. If we keep stdin open (needed to send
  control responses) but the turn needs **zero** permissions, the CLI may wait forever and never
  emit `result`/`exit` → `claude:done` never fires → UI hangs "running". Capture: does the turn end
  on its own and emit a `result` event with stdin still open? Almost certainly **yes** — so the
  close strategy is "**end stdin when the `result` event is seen on stdout**", NOT on `exit`
  (which won't come). Confirm this in the spike; it drives Task 5.2.

### Task 5.1 — Protocol framing module (test first)

- [ ] `electron/permissionProtocol.ts` ADD pure functions (shapes filled in from Task 5.0):
  ```ts
  export function buildUserMessage(prompt: string): string   // JSON line for stdin
  export function parseControlRequest(evt: unknown): { id: string; tool: string; input: unknown } | null
  export function buildControlResponse(id: string, decision: 'allow' | 'deny', opts?): string // JSON line
  ```
- [ ] `electron/permissionProtocol.test.ts` — `buildUserMessage` emits valid single-line JSON with
  the prompt in the content field (and ONLY there — never argv); `parseControlRequest` returns null
  for non-control events and extracts ids for control ones; `buildControlResponse` round-trips.

### Task 5.2 — Rework startTurn (main)

- [ ] `electron/claude.ts` `buildArgs` — change `--input-format text` default to
  `'--input-format', 'stream-json'` (add to the array; keep `--output-format stream-json`).
  **Fallback (from review):** if the spike shows stream-json input changes normal (no-permission)
  turn behavior in any risky way, gate stream-json behind `default`-mode-only and keep the proven
  text-stdin path for P1–P4 modes — rather than making stream-json the unconditional default.
- [ ] `startTurn` (claude.ts:108-157):
  - Write `buildUserMessage(a.prompt)` + `\n` to stdin **but do NOT `end()` immediately** — keep it
    open so control responses can be written back.
  - In the stdout line loop, before forwarding to `claude:event`, run `parseControlRequest`; if it
    matches, emit `claude:permission-request` `{ turnId, id, tool, input }` to the renderer and do
    NOT forward as a normal event.
  - **CRITICAL stdin-close (from review):** when the parsed line is the `result` event (turn
    complete), call `proc.stdin.end()`. This is the real terminator — do NOT wait for `exit` to
    close stdin (it would deadlock on zero-permission turns). Also `end()` on `cancel`.
  - Track open stdin per turn (already have `turns` map of `ChildProcess` → reuse `proc.stdin`).
- [ ] Add main IPC handler `claude:permission-response` `{ turnId, id, decision }` in
  **`electron/main.ts`** (near the `claude:start` registration ~line 373) →
  looks up the turn's `proc` and `proc.stdin.write(buildControlResponse(id, decision) + '\n')`.
  Expose a `respondPermission(turnId,id,decision)` export from claude.ts for the handler to call.

### Task 5.3 — preload + IPC surface

- [ ] `electron/preload.ts` `claude` block — add:
  ```ts
  onPermissionRequest: (cb) => { /* ipcRenderer.on('claude:permission-request', ...) */ },
  respondPermission: (turnId, id, decision) => ipcRenderer.invoke('claude:permission-response', { turnId, id, decision }),
  ```
- [ ] `src/renderer/cli/types.ts` — add `PermissionRequestMsg { turnId; id; tool; input }` and a
  `PermissionDecision = 'allow' | 'deny'`.
- [ ] **`src/renderer/cli/claudeClient.ts` (review gap — existing turns route through here, not
  preload directly):** add a `respondPermission(turnId,id,decision)` method and a permission
  channel in the `TurnHandlers` interface + `subscribe()` so App.tsx subscribes the same way it
  does for `onEvent`/`onDone`. Do NOT bypass claudeClient straight to preload — match the existing pattern.

### Task 5.4 — Renderer dialog

- [ ] `src/renderer/views/chat/PermissionPrompt.tsx` ADD — modal showing tool + input, Allow / Deny
  buttons (and an "Always allow this tool" that appends a P2 allow rule). Accessible: focus trap,
  `role="alertdialog"`, Enter=Allow / Esc=Deny.
- [ ] `src/renderer/App.tsx` — subscribe via `onPermissionRequest`, queue requests, render
  `PermissionPrompt` for the head of the queue, call `respondPermission` on decision.

### Task 5.5 — Regression: prompt still off argv

- [ ] `electron/claude.test.ts` — assert `buildArgs` now contains `--input-format`,`stream-json`
  and STILL never contains the prompt; add a `permissionProtocol` test proving the nasty-metachar
  prompt only appears inside the JSON content string, never as a bare argv token.

**Phase 5 done when:** a tool needing permission under `default` mode pops the dialog; Allow
proceeds, Deny blocks; prompt-injection invariant intact; existing turns still stream normally.

---

## Parallelization Analysis

**Phases are mostly sequential** because the core files `electron/claude.ts` (buildArgs +
StartTurnArgs), `electron/preload.ts`, `src/renderer/cli/types.ts`, and `src/renderer/App.tsx`
are edited by **every** phase. Running two phases that both edit `buildArgs` concurrently = merge
conflict. So the critical path is **P1 → P2 → P3 → P4 → P5** (each adds to the same buildArgs/contract).

**Where parallelism is safe — new standalone files within a phase** (no overlap with the core
files until the final wire-up step):

- **Batch A (start immediately, parallel):**
  - `electron/permissions.ts` + `permissions.test.ts` (P4 builder) — disjoint, no core edits.
  - `electron/permissionProtocol.ts` + test (P5 framing) — disjoint (after Task 5.0 spike).
  - `src/renderer/settings/permissionRules.ts` + test (P2/P4 helper) — disjoint.
  - `src/renderer/components/controls/ToolRulesEditor.tsx` (P2 UI, pure component) — disjoint.
  - `src/renderer/components/controls/DirScopeEditor.tsx` (P3 UI) — disjoint.
  - `src/renderer/views/chat/PermissionPrompt.tsx` (P5 UI) — disjoint.
  These are leaf modules/components with their own tests; they can be authored in parallel by
  separate subagents, each TDD'd in isolation.
- **Sequential spine (one writer, in order):** all edits to `claude.ts` / `preload.ts` /
  `cli/types.ts` / `App.tsx` — the wire-up steps of every phase. Do these single-threaded, phase
  by phase, pulling in the already-built leaf modules from Batch A.
- **Task 5.0 (spike) gates 5.1–5.4** — must finish before the protocol module is finalized.

**Longest sequential chain (critical path):** P1 enum+guards → P2 buildArgs+contract →
P3 buildArgs → P4 buildArgs+settings → P5.0 spike → P5 startTurn rewrite → P5 wire-up.

**Cannot be parallel:** anything editing `buildArgs`, `StartTurnArgs`, the preload inline type,
`cli/types.ts`, or `App.tsx`.

---

## Execution options

**1. Parallel subagent execution (recommended)** — dispatch Batch A leaf modules concurrently
(separate subagents, non-overlapping files, each TDD-green), with one aggregating reviewer keeping
`npm test` green. Then a single writer walks the sequential spine P1→P5, importing the leaf
modules. Finish with `/code-review` + `/simplify` in parallel.

**2. Subagent-Driven** (`superpowers:subagent-driven-development`) — fresh subagent per task, two-
stage review. Good fit here since the spine is highly sequential.

**3. Inline Execution** (`superpowers:executing-plans`) — batch with checkpoints; simplest, lowest overhead.

**Recommendation given the heavy shared-file coupling:** Option 3 (inline) for the sequential
spine + optionally pre-build Batch A leaf files first. Pure parallelism buys little here because
4 core files are touched by every phase.
