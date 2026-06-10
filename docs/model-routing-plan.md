# ClaudeDeck — Per-Turn Model Routing (Suggest + Confirm, Hybrid difficulty)

**Goal:** Pick the cost-appropriate model per turn (cheap for easy, Fable 5 only for the
genuinely hard) by *suggesting* a model before each turn and letting the user confirm.
Save money without sacrificing quality on hard turns.

> **Review fixed (plan-pro spawned review, 2 reviewers):**
> 1. **Tier↔id mismatch (both reviewers, critical).** The pipeline speaks **picker ids**
>    (`opus-4-8`, `sonnet-4-6`, `haiku-4-5`) end-to-end (`Composer` state, `handleSend(text,
>    modelId)`, `claude.start({model})`, `MODEL_ALIASES`). The heuristic's `Tier` is internal
>    vocabulary only — added explicit **`TIER_TO_MODEL_ID`** + **`modelIdToTier()`** maps so the
>    Tier→picker-id→CLI chain is single-sourced and unit-tested (Task 1).
> 2. **`fable` had no end-to-end identity (both, critical).** Added `fable-5` to `MODELS`
>    (picker option) **and** `MODEL_ALIASES['fable-5']='claude-fable-5'` **and**
>    `TIER_TO_MODEL_ID.fable='fable-5'`. Verified `toCliModel('fable-5') → 'claude-fable-5'`.
> 3. **`ChatMessage` had no `model` field (R-A, gap).** Badge was un-buildable. Added
>    `model?: string` to `ChatMessage`, stamped in `handleSend`, rendered in the message header
>    (Task 6).
> 4. **Settings schema unspecified (R-A, gap).** Pinned 3 concrete `Settings` keys + defaults +
>    a round-trip persistence test (Task 5).
> 5. **`RoutingContext` inputs didn't exist (both, gap).** App has no attachments. **Dropped
>    `attachedFileCount`**; `hasErrorTrace` is now a pure `detectErrorTrace(prompt)` detector.
> 6. **Heuristic was English-only → dead for the (Thai) primary user (R-B, gap).** Added Thai
>    keyword sets and a defined "no-signal" path: long no-signal prompt → `needsClassifier`.
> 7. **Classifier would hang / mis-route (both, critical).** Mandated: separate minimal
>    arg-builder (NOT `buildArgs` — must omit `--permission-prompt-tool stdio` and `--resume`),
>    `--input-format stream-json`, `buildInitialize`+`buildUserMessage`, `stdin.end()` on
>    `result`, a **hard timeout + `proc.on('error')` → reject**, and the renderer **falls back to
>    the heuristic** on any failure. Parser has a **strict allow-list, unmatched → resting tier
>    (never `fable`, never throws)** (Task 2/3).
> 8. **Auto mode could silently spend Fable (R-B, critical).** Encoded the safe rule: **auto
>    never auto-escalates to `fable`** — an upgrade *to fable* always confirms, even in auto
>    (honors the global "announce before spending Fable" rule).
> 9. **Voice-confirm path was global, would collide (both, critical).** Existing `opus/haiku/
>    sonnet` voice commands would change the composer instead of answering the dialog. Encoded
>    **dialog-scoped command injection**: while the dialog is open, model-name utterances resolve
>    the dialog and the composer setters are suppressed (Task 4/6).
> 10. **`handleSend` sync→async + re-entrancy (R-B, critical).** Inserting `await classifier` +
>     a modal means `handleSend` becomes async and message creation moves **after** confirm. Added
>     a **pending-suggestion lock** so a second send (Enter/voice) can't open a second dialog, and
>     a classifier **aria-live announcement + timeout** so a blind user isn't left in silence.
> 11. **A11y (R-B, advisory→applied):** dialog **restores focus** to the composer on close, and
>     the focus trap **cycles all four** buttons (the 2-button toggle in `PermissionPrompt` is
>     insufficient here).

## Why this is small (the key insight)

ClaudeDeck already spawns a fresh `claude` process **per turn** and maintains context via
`--resume <sessionId>` (transcript replay — model-agnostic). Model is an independent
`--model` flag ([electron/claude.ts:173](../electron/claude.ts), `buildArgs`). So **changing
the model per turn while keeping full context already works** end-to-end (ModelPicker → IPC
`claude:start` → `buildArgs` → `--model`). No runtime mid-stream switch, no context loss. We
only need a "brain" that decides the `--model` value per turn, plus a confirm UX.

## Decisions (approved in chat — do not relitigate)

- **Routing mode:** Suggest + confirm. Before a turn, suggest a model; user confirms or overrides.
- **Difficulty judgment:** Hybrid — fast pure heuristic first; only when the heuristic is
  low-confidence/borderline, fire a cheap Haiku classifier turn.
- **When to actually prompt:** only surface the confirm UI when the suggested tier is **higher**
  than the resting model (especially → Fable 5), or when confidence is **high** and the
  suggestion differs. Same-or-cheaper at non-high confidence → proceed silently with the resting
  model (still show the per-message badge). Setting flips this to "always confirm" or "auto".
- **Resting/default model:** Opus 4.8 (the safe middle). Configurable.
- **Feature default:** routing mode **`off`** — opt-in. Auto-route is a setting, never the default.
- **Accessibility (first-class — blind user):** the confirm UI is keyboard-operable, focus-managed
  (incl. focus restore), announces suggestion + reason via `aria-live="assertive"`, and is
  confirmable by voice through the existing voice-command map.

## Model ladder

| Tier (internal) | Picker id | `--model` (via `toCliModel`) | Use |
|---|---|---|---|
| `haiku` | `haiku-4-5` | `haiku` | mechanical/batch/short, low-judgment |
| `sonnet` | `sonnet-4-6` | `sonnet` | normal coding/Q&A |
| `opus` (resting) | `opus-4-8` | `opus` | default; complex but routine |
| `fable` | `fable-5` | `claude-fable-5` | architecture / deep-debug / high-stakes only |

`TIER_ORDER`: `haiku=0 < sonnet=1 < opus=2 < fable=3`.

---

## Components & build order (TDD — pure logic first; RED→GREEN→refactor each)

### Task 1 — Pure heuristic + tier maps — `src/renderer/settings/modelRouting.ts` (+ `.test.ts`)

Matches the existing testable-pure-module pattern ([voiceCommands.ts](../src/renderer/settings/voiceCommands.ts),
[hydrationDecision.ts](../src/renderer/settings/hydrationDecision.ts)).

```ts
export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type RoutingMode = 'off' | 'suggest' | 'auto'

export const TIER_ORDER: Record<Tier, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3 }

/** Internal Tier → ClaudeDeck picker id (the value handed to claude.start({model})). */
export const TIER_TO_MODEL_ID: Record<Tier, string> = {
  haiku: 'haiku-4-5', sonnet: 'sonnet-4-6', opus: 'opus-4-8', fable: 'fable-5',
}
/** Picker id → Tier. Unknown / custom-* ids fall back to the safe middle (opus). */
export function modelIdToTier(id: string | undefined): Tier {
  switch (id) {
    case 'haiku-4-5': return 'haiku'
    case 'sonnet-4-6': return 'sonnet'
    case 'fable-5': return 'fable'
    default: return 'opus' // 'opus-4-8', custom-*, undefined
  }
}

export interface RoutingContext {
  prompt: string
  hasErrorTrace?: boolean   // pasted stack trace / error log (see detectErrorTrace)
  restingTier: Tier
}
export interface Suggestion {
  tier: Tier
  confidence: 'low' | 'medium' | 'high'
  reason: string            // shown to user + aria-live (bilingual handled by caller label map)
  needsClassifier: boolean  // true when the heuristic is borderline → caller may fire Haiku
}

/** Pure: does the prompt look like a pasted error/stack trace? (TH+EN + structural). */
export function detectErrorTrace(prompt: string): boolean

/** Pure heuristic. Never throws; always returns a Suggestion. */
export function suggestModelHeuristic(ctx: RoutingContext): Suggestion
```

**Signals (named constants; tune weights in tests):**
- **Hard-up keywords** (push toward `opus`/`fable`) — match case-insensitively against the
  prompt; include **EN + TH**:
  - EN: `architecture`, `refactor`, `concurrency`, `race condition`, `deadlock`, `prove`,
    `design the`, `migrate`, `debug`, `root cause`, `optimize the algorithm`, `distributed`.
  - TH: `สถาปัตยกรรม`, `รีแฟกเตอร์`, `ออกแบบระบบ`, `ดีบัก`, `แก้บั๊ก`, `หาเหตุ`, `ย้ายระบบ`, `concurrency`/`race` (often written in EN even in Thai prompts).
- **Easy-down keywords** (push toward `haiku`) — EN: `rename`, `format`, `list`, `read`,
  `where is`, `typo`, `comment`; TH: `เปลี่ยนชื่อ`, `จัดรูปแบบ`, `อ่าน`, `ลิสต์`, `อยู่ไหน`, `พิมพ์ผิด`.
- **Structural:** `hasErrorTrace` (push up); prompt length — `< SHORT_CHARS (40)` nudges down,
  `> LONG_CHARS (600)` nudges up.

**Algorithm (deterministic, table-tested):**
1. Score = (hard hits → +) − (easy hits → −), plus structural nudges.
2. Map score → base tier relative to `restingTier`: strong-hard → `fable`; mild-hard → one tier
   up from resting (capped at `fable`); strong-easy → `haiku`; mild-easy → one tier down (floor
   `haiku`); neutral → `restingTier`.
3. **Confidence:** `high` when a strong, unambiguous signal fired (e.g. `fable` keyword or
   error-trace + length); `medium` when one weak signal; `low` when signals conflict OR **no
   signal fired at all on a non-trivial prompt** (`length >= MIN_CLASSIFIER_CHARS (80)`).
4. **`needsClassifier = confidence === 'low'`.** Short no-signal prompts stay `medium`→resting
   (not worth a paid classifier call); long no-signal prompts go `low`→classifier. This is the
   path that rescues Thai/odd-phrasing prompts the keyword sets miss.

**Tests (RED first):** table of representative prompts → expected `{tier, confidence,
needsClassifier}`, including: EN hard→fable(high), EN easy→haiku(high), error-trace→up,
**Thai hard prompt** (keyword) → up, **Thai no-signal long prompt** → `needsClassifier:true`,
short greeting → resting/medium/no-classifier, conflicting (`rename the architecture doc`) →
`low`+`needsClassifier`. Plus unit tests for `TIER_TO_MODEL_ID`/`modelIdToTier` round-trip and
`detectErrorTrace`. Assert the `needsClassifier` band is actually reachable.

### Task 2 — Haiku classifier (main) — `electron/modelClassifier.ts` (+ `.test.ts`) + IPC

Only invoked when `needsClassifier`. A throwaway one-shot Haiku turn. **Must NOT reuse
`buildArgs`** (it always adds `--permission-prompt-tool stdio`, which would start the permission
control protocol) and **must NOT** pass `--resume` (no transcript, no side effects, minimal cost).

```ts
import type { Tier } from '../src/renderer/settings/modelRouting' // type-only import OK across boundary
// NOTE: `Tier` is a pure type; importing the type only (no runtime value) is safe.
// If the build forbids the cross-boundary import, duplicate the union here and unit-test
// both copies stay in sync, mirroring the documented `cleanRules` duplication (claude.ts:50).

const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'fable']

/** Pure. Map Haiku's final `result` text → Tier. Strict allow-list; unmatched/empty → resting. */
export function parseClassifierResult(resultText: string | undefined, restingTier: Tier): Tier {
  if (!resultText) return restingTier
  const t = resultText.toLowerCase()
  // First whole-word tier token wins; never default to fable on garbage.
  for (const tier of TIERS) if (new RegExp(`\\b${tier}\\b`).test(t)) return tier
  return restingTier
}

const CLASSIFY_TIMEOUT_MS = 4000
const CLASSIFY_PROMPT = (userPrompt: string): string =>
  `You are a model-routing classifier. Read the user's task and reply with EXACTLY ONE word, ` +
  `lowercase, no punctuation, chosen from: haiku, sonnet, opus, fable. ` +
  `haiku = trivial/mechanical; sonnet = normal coding/Q&A; opus = complex but routine; ` +
  `fable = architecture / deep multi-step debugging / high-stakes reasoning only.\n\nTASK:\n${userPrompt}`

/** Spawn a one-shot Haiku classify turn. Resolves to a Tier; on ANY failure resolves to restingTier. */
export function classifyTurn(prompt: string, restingTier: Tier): Promise<Tier>
```

`classifyTurn` spawn contract (reuse helpers from `claude.ts`/`permissionProtocol.ts`):
- Args: `['-p','--output-format','stream-json','--verbose','--input-format','stream-json','--model','haiku']`.
  (Extract a shared `spawnClaudeOneShot`/arg helper in `claude.ts` if cleaner, but it must be a
  *separate* arg list from `buildArgs`.)
- `detectClaude()` first; if null → resolve `restingTier` (NOT reject — feature degrades, send proceeds).
- Windows: spawn via `cmd.exe /c` like `startTurn` (claude.ts:204).
- Write `buildInitialize()` + `buildUserMessage(CLASSIFY_PROMPT(prompt))` to stdin.
- Parse stdout lines; on the `result` event (`isResultEvent`), read `result?: string`
  ([cli/types.ts:64](../src/renderer/cli/types.ts) `ResultEvent`), `stdin.end()`, resolve
  `parseClassifierResult(result, restingTier)`.
- **`setTimeout(CLASSIFY_TIMEOUT_MS)`** → kill the child + resolve `restingTier`. `proc.on('error')`
  (binary missing) → resolve `restingTier`. Never hangs, never rejects.

IPC: `safeHandle(ipcMain, 'model:classify', (_e, a: {prompt: string; restingTier: Tier}) =>
classifyTurn(a.prompt, a.restingTier), (/* fallback */) => a.restingTier)` in
[main.ts](../electron/main.ts) (~near `claude:start`, line 447). Preload bridge:
`claude.classify: (prompt, restingTier) => ipcRenderer.invoke('model:classify', {prompt, restingTier})`
in [preload.ts](../electron/preload.ts) (under the `claude` namespace).

**Tests:** `parseClassifierResult` table — `'fable'`→fable, `'  Opus.\n'`→opus, full sentence
containing a tier word → that tier, empty/`undefined`/`'banana'`/`is_error` → `restingTier`,
never `fable` on garbage. (Spawn path: optional thin mock-`child_process` smoke test like existing
electron tests; the value is in the pure parser.)

### Task 3 — Routing decision (pure) — add to `modelRouting.ts` (+ tests)

```ts
export interface RoutingDecision {
  modelId: string                 // picker id to spawn with (TIER_TO_MODEL_ID[tier])
  tier: Tier
  action: 'silent' | 'confirm'    // confirm → show ModelSuggestion dialog
  suggestion: Suggestion          // carried for the dialog's reason text
}

/** Pure. Combine suggestion + mode + resting into the final action. Never throws. */
export function decideRouting(
  s: Suggestion,
  restingTier: Tier,
  mode: RoutingMode,
  alwaysConfirm: boolean,
): RoutingDecision
```

Rules (table-tested):
- `mode === 'off'` → `{ tier: restingTier, action: 'silent' }`. (feature disabled)
- Let `up = TIER_ORDER[s.tier] > TIER_ORDER[restingTier]`, `differs = s.tier !== restingTier`.
- `mode === 'suggest'`:
  - `alwaysConfirm` → `confirm` (suggested tier).
  - `up` → `confirm` (never silently spend more; esp. fable).
  - `differs && s.confidence === 'high'` → `confirm` (offer the high-confidence change, incl. savings).
  - else → `silent` at **`restingTier`** (per approved "same-or-cheaper at non-high → stay resting").
- `mode === 'auto'`:
  - `alwaysConfirm` → behaves like suggest (always `confirm`).
  - `s.tier === 'fable' && up` → **`confirm`** (auto NEVER auto-escalates to fable — global rule).
  - else → `silent` at **`s.tier`** (auto applies the suggestion, incl. cheaper downgrades = savings).

**Tests:** matrix over {off, suggest, auto} × {downgrade, same, upgrade-to-opus, upgrade-to-fable}
× {low, high confidence} × {alwaysConfirm t/f}. Key asserts: off→always silent+resting; suggest
upgrade→confirm; suggest low-conf downgrade→silent+resting; auto sonnet→silent+sonnet; auto
upgrade-to-fable→confirm (the safety property).

### Task 4 — `ModelSuggestion` confirm dialog — `src/renderer/views/chat/ModelSuggestion.tsx` (+ `.test.tsx`)

Mirror the a11y baseline of [PermissionPrompt.tsx](../src/renderer/views/chat/PermissionPrompt.tsx),
extended for 4 actions and focus restore.

```ts
export interface ModelSuggestionProps {
  decision: RoutingDecision
  restingTier: Tier
  /** Resolve the pending send: confirm(suggested) | useResting | a specific tier (override). */
  onChoose: (tier: Tier) => void
  /** Bilingual label for a tier (e.g. 'Opus 4.8'); injected so the dialog has no fixtures dep. */
  tierLabel: (t: Tier) => string
  th: boolean
}
```
- `role="alertdialog"`, `aria-modal`, `aria-labelledby`/`aria-describedby`.
- On open: move focus to the **Confirm** button; **store `document.activeElement`** and **restore
  it on unmount** (composer textarea) — blind user must not lose focus into the void.
- `aria-live="assertive"` region announces `"<th?'แนะนำ':'Suggested'> <tierLabel(tier)> — <reason>"`.
- Buttons: **Confirm `<suggested>`** (Enter), **Use `<resting>`** (Esc), **↑ Fable**, **↓ Haiku**.
- `Tab`/`Shift+Tab` cycle **all four** buttons (real trap, not the 2-button toggle).
- No color-only signalling (text labels carry meaning).

**Tests:** renders reason in the `aria-live` region; Enter→`onChoose(suggested)`; Esc→
`onChoose(resting)`; clicking ↑Fable→`onChoose('fable')`; focus starts on Confirm; Tab cycles 4.

### Task 5 — Settings (routing mode + resting model + always-confirm)

In [SettingsContext.tsx](../src/renderer/settings/SettingsContext.tsx) add to `Settings` +
`DEFAULTS` (note: `withDefaults` already spreads `DEFAULTS`, so partial loads coerce safely):

```ts
/** Per-turn model routing: off (disabled), suggest (confirm dialog), auto (apply silently). */
modelRouting: RoutingMode        // default 'off'
/** Resting/default model picker id used when routing is off or yields no change. */
restingModel: string             // default 'opus-4-8'
/** When routing is on, always show the confirm dialog (even for same/cheaper). */
routingAlwaysConfirm: boolean     // default false
```
Settings UI: a **radiogroup** for `modelRouting` (off/suggest/auto) and one for `restingModel`
(the 4 ladder models) + a toggle for `routingAlwaysConfirm`, following the established settings
a11y pattern (preview-on-select, radiogroup semantics) — see existing voice/STT settings sections.

**Tests:** `withDefaults({})` yields the 3 new defaults; a round-trip
`withDefaults({modelRouting:'auto', restingModel:'fable-5', routingAlwaysConfirm:true})` preserves
them; `decideHydration` unaffected (existing tests stay green).

### Task 6 — Send-flow wiring + model badge — `App.tsx` / `fixtures.ts` / message header

**6a. Model ladder data (no-overlap, do first):**
- `MODELS` ([fixtures.ts:33](../src/renderer/mock/fixtures.ts)): add
  `{ id: 'fable-5', provider: 'claude', label: 'Claude Fable 5', sublabel: 'Hardest / high-stakes' }`.
- `MODEL_ALIASES` ([claude.ts:130](../electron/claude.ts)): add `'fable-5': 'claude-fable-5'`.
  (Verify `toCliModel('fable-5') === 'claude-fable-5'` in `claude.test.ts`.)
- `ChatMessage` ([fixtures.ts:77](../src/renderer/mock/fixtures.ts)): add `model?: string`
  (picker id the turn ran on).

**6b. `handleSend` becomes async + routing step ([App.tsx:494](../src/renderer/App.tsx)):**
1. Keep the existing B4 running-guard. Add a **pending-suggestion lock** (`pendingRouteRef` /
   `modelSuggestion` state): if a route decision is already awaiting confirm for this session,
   a second send is ignored (speak `STATUS.busy`), so Enter/voice can't open a second dialog.
2. Build `RoutingContext { prompt: text, hasErrorTrace: detectErrorTrace(text), restingTier:
   modelIdToTier(settings.restingModel) }`. (The composer still passes its own `modelId`; when
   routing is `off` we use that as today — routing only overrides when enabled.)
3. `const s = suggestModelHeuristic(ctx)`. If `s.needsClassifier && settings.modelRouting !== 'off'`:
   announce via `setLiveStatus(say({th:'กำลังเลือกโมเดล…', en:'Choosing model…'}))`, then
   `const tier = await window.claudedeck.claude.classify(text, ctx.restingTier)` and rebuild `s`
   with that tier (confidence → `high`, `needsClassifier:false`). The IPC itself is timeout-bounded
   and falls back to resting, so the await is safe.
4. `const decision = decideRouting(s, ctx.restingTier, settings.modelRouting, settings.routingAlwaysConfirm)`.
5. Resolve the final picker id:
   - `decision.action === 'silent'` → `chosenModelId = settings.modelRouting === 'off' ? modelId
     : decision.modelId`.
   - `decision.action === 'confirm'` → open `ModelSuggestion`, `await` the user's `onChoose(tier)`
     (promise stored in `pendingRouteRef`), `chosenModelId = TIER_TO_MODEL_ID[chosenTier]`.
6. **Only now** create `userMessage` + `assistantMessage` (stamp `model: chosenModelId`) and call
   `claudeClient.startTurn({ ..., model: chosenModelId })`. (Everything below today's line 502 moves
   into a helper `runTurn(text, chosenModelId, effort)` so both the silent and confirmed paths reuse it.)

**6c. Voice-confirm (dialog-scoped) ([App.tsx:213+](../src/renderer/App.tsx)):**
- While `modelSuggestion` is open, prepend dialog commands to `liveCommands`:
  `ใช้ตามแนะนำ/confirm/ตกลง` → resolve(suggested); `ใช้ opus/ใช้ resting/ยกเลิก/esc` → resolve(resting);
  `ไฮกุ/haiku`, `โอปุส/opus`, `ซอนเน็ต/sonnet`, `เฟเบิล/fable` → resolve(that tier).
- **Suppress collision:** while the dialog is open, the existing `model opus/sonnet/haiku`
  composer-setter commands must NOT fire (they'd set the composer instead of answering the dialog).
  Implement by branching `liveCommands`: when `modelSuggestion` is set, the model-name phrases map
  to the dialog resolver; otherwise to `composerRef.current?.setModel`.

**6d. Badge:** in the assistant message header (grep the message renderer that consumes
`ChatMessage` — e.g. `MessageBubble`/`AssistantMessage` under `views/chat`), when `message.model`
is set render a small label via `MODELS.find(m => m.id === message.model)?.label ?? message.model`.
Existing fixtures have no `model` → badge simply absent (no regression).

---

## Out of scope (note, don't build)
- Runtime mid-stream model switch (not needed — per-turn covers it; CLI has no such control request).
- Attachments-based signals (the app has no attachment mechanism; `attachedFileCount` dropped).
- Auto-route without confirm as the default (it is a setting; default is `off`).

## Parallelization analysis
- **Critical path (sequential):** Task 1 (types/maps/heuristic) → Task 3 (`decideRouting` uses
  `Suggestion`/`TIER_ORDER`) → Task 6 (wiring uses all of 1/2/3/4/5).
- **Batch A — parallel after Task 1 (disjoint files):** Task 2 (`electron/modelClassifier.ts`,
  `main.ts`, `preload.ts`), Task 4 (`ModelSuggestion.tsx`), Task 5 (`SettingsContext.tsx` + settings
  view). None overlap each other or Task 3's file.
- **Task 3** edits `modelRouting.ts` (same file as Task 1) → must follow Task 1, not parallel with it.
- **Task 6** is last (integrates everything; touches `App.tsx`, `fixtures.ts`, `claude.ts`,
  message header) and is a single sequential step.

## Test/verify plan
- **Unit (≥80% on new logic):** `modelRouting.test.ts` (heuristic table incl. Thai + no-signal +
  conflicting; `TIER_TO_MODEL_ID`/`modelIdToTier`; `detectErrorTrace`; `decideRouting` matrix incl.
  the auto-never-escalates-to-fable safety case). `modelClassifier.test.ts` (`parseClassifierResult`
  edge cases). `claude.test.ts` (`toCliModel('fable-5')==='claude-fable-5'`). Settings round-trip.
  `ModelSuggestion.test.tsx` (a11y: aria-live, Enter/Esc, focus start, 4-button Tab cycle).
- **Integration:** optional mock-spawn classifier smoke test; a `handleSend` test asserting the
  chosen model id reaches `claude.start` and is stamped on `assistantMessage.model`.
- **Manual (preview):** easy prompt → silent resting + badge; `architecture…` prompt → suggests
  Fable, dialog announces via aria-live; confirm → spawn carries `--model claude-fable-5`; Thai
  no-signal long prompt → classifier fires (status announced) then routes. Keyboard-only +
  screen-reader pass on the dialog and the new settings radiogroups.
