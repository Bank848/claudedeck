# ClaudeDeck — Per-Turn Model Routing (Suggest + Confirm, Hybrid difficulty)

**Goal:** Pick the cost-appropriate model per turn (cheap for easy, Fable 5 only for the
genuinely hard) by *suggesting* a model before each turn and letting the user confirm.
Save money without sacrificing quality on hard turns.

## Why this is small (the key insight)

ClaudeDeck already spawns a fresh `claude` process **per turn** and maintains context via
`--resume <sessionId>` (transcript replay — model-agnostic). Model is an independent
`--model` flag (`electron/claude.ts:181`, `:173`). So **changing the model per turn while
keeping full context already works** end-to-end (ModelPicker → IPC `claude:start` →
`buildArgs` → `--model`). No runtime mid-stream switch, no context loss. We only need a
"brain" that decides the `--model` value per turn, plus a confirm UX.

## Decisions (approved in chat)

- **Routing mode:** Suggest + confirm. Before a turn, suggest a model; user confirms or overrides.
- **Difficulty judgment:** Hybrid — fast pure heuristic first; only when the heuristic is
  low-confidence/borderline, fire a cheap Haiku classifier turn.
- **When to actually prompt (default to keep it non-annoying):** only surface the confirm UI
  when the suggested tier is **higher** than the current resting model (especially → Fable 5),
  or when confidence is high and the suggestion differs. Same-or-cheaper suggestion → proceed
  silently with the resting model (still show the per-message badge). User can flip a setting
  to "always confirm" or "never confirm (auto)".
- **Resting/default model:** Opus 4.8 (the safe middle). Configurable.
- **Accessibility (first-class — blind user):** the confirm UI must be keyboard-operable,
  focus-managed, and announce the suggestion + reason via `aria-live`. A voice command must be
  able to confirm/override (reuse the existing voice-command pattern).

## Model ladder

| Tier | Model (`--model`) | Use |
|---|---|---|
| cheap | `haiku` | mechanical/batch/short, low-judgment |
| standard | `sonnet` | normal coding/Q&A |
| hard (resting) | `opus` (= claude-opus-4-8) | default; complex but routine |
| hardest | `claude-fable-5` | architecture/deep-debug/high-stakes only |

(`MODEL_ALIASES` in `electron/claude.ts` already maps picker ids → CLI aliases; add a
`fable-5` → `claude-fable-5` entry.)

---

## Components & build order (TDD — pure logic first)

### 1. Pure heuristic — `src/renderer/settings/modelRouting.ts` (+ `.test.ts`)
Matches the existing testable-pure-module pattern (`voiceCommands.ts`, `hydrationDecision.ts`).

```ts
export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'
export interface RoutingContext {
  prompt: string
  attachedFileCount?: number
  hasErrorTrace?: boolean      // pasted stack trace / error log
  restingTier: Tier
}
export interface Suggestion {
  tier: Tier
  confidence: 'low' | 'medium' | 'high'
  reason: string               // shown to user + aria-live
  needsClassifier: boolean     // true when heuristic is borderline → caller fires Haiku
}
export function suggestModelHeuristic(ctx: RoutingContext): Suggestion
```

Heuristic signals (weights, tune in tests):
- Hard-up keywords: `architecture|refactor|concurrency|race|deadlock|prove|design the|migrate|debug` → push toward opus/fable.
- Error trace present / very long prompt / many attached files → push up.
- Short imperative / "rename|format|list|read|where is" → push toward haiku.
- Output: tier + confidence. `needsClassifier = confidence === 'low'` (borderline band).

Tests (RED first): table of representative prompts → expected tier/confidence; borderline cases set `needsClassifier`.

### 2. Haiku classifier — `electron/modelClassifier.ts` (+ IPC) 
Only invoked when `needsClassifier`. A throwaway `claude --model haiku -p` (NO `--resume`,
NO permission tool) with a tiny classification prompt; parse one-word tier from stdout.

- `electron/modelClassifier.ts`: `classifyTurn(prompt: string): Promise<Tier>` — spawn
  `claude` with `['-p','--output-format','stream-json','--model','haiku']`, write a
  classification user message over stdin, read the final `result` text, map to a Tier.
  Reuse the spawn/line-parse helpers already in `claude.ts` (extract a shared
  `spawnClaudeOneShot` if cleaner).
- IPC: `main.ts` handler `model:classify` → calls `classifyTurn`. Preload bridge method.
- Tests: unit-test the stdout→Tier parser with fixture lines (pure fn); the spawn path gets
  a thin integration smoke test (mock child_process) like existing electron tests.

### 3. Send-flow wiring — renderer composer
Where the renderer currently calls `claude:start` (IPC, model from ModelPicker), insert the
routing step **before** spawn:

1. Build `RoutingContext` from the composer (prompt, attachments, detect pasted trace, resting tier from settings).
2. `s = suggestModelHeuristic(ctx)`; if `s.needsClassifier` → `await ipc.modelClassify(prompt)` and merge.
3. Apply the "when to prompt" rule (above). If prompting → show `ModelSuggestion` confirm;
   else proceed with resting/suggested tier silently.
4. Spawn the turn with the chosen `--model`.

### 4. `ModelSuggestion` confirm component — `src/renderer/components/ModelSuggestion.tsx`
- Renders: suggested model + `reason`, buttons: **Confirm <suggested>**, **Use <resting>**,
  and quick **↑Fable / ↓Haiku**.
- A11y: `role="alertdialog"`, focus trap, `aria-live="assertive"` announces
  "Suggested <model> — <reason>"; Enter confirms, Esc = use resting. Wire a voice command
  ("ใช้ตามแนะนำ" / "ใช้ opus") through the existing voice-command map.

### 5. Settings + per-message badge
- Settings: routing mode (`off | suggest | auto`), resting model, "always confirm" toggle.
  Persist with existing settings mechanism; expose in Settings UI with radiogroup semantics
  (a11y pattern already established).
- Badge: show which model actually ran on each assistant message (small label). The turn
  already knows its model — thread it into the message metadata and render in the message header.

---

## Out of scope (note, don't build)
- Runtime mid-stream model switch (not needed — per-turn covers it; CLI has no such control request anyway).
- Auto-route without confirm is a *setting*, not the default.

## Test/verify plan
- Unit: `modelRouting.test.ts` (heuristic table), classifier parser test.
- Integration: mock-spawn classifier smoke test.
- Manual (preview): type an easy prompt → no/cheap suggestion; type an "architecture…" prompt
  → suggests Fable, confirm dialog announces via aria-live; confirm → turn runs on Fable
  (verify `--model claude-fable-5` in spawn); badge shows correct model.
- A11y: keyboard-only + screen-reader pass on the confirm dialog and settings.
