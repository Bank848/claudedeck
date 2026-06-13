# Mid-Turn Message Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user type and queue follow-up messages while a turn is running (Codex/Claude-Code style); queued messages auto-send one at a time as separate turns when the current turn finishes, with an "interrupt now" option and editable/removable queue chips.

**Architecture:** Queue lives in `Session.queued: QueuedMessage[]` managed by the pure `sessionsReducer` (new `enqueue`/`removeQueued`/`updateQueued` actions). The Composer no longer blocks send while busy — Enter enqueues, Ctrl+Enter interrupts (stop current + run now). A `useEffect` in `App.tsx` watches all sessions and, when a session is `idle` with a non-empty queue, dequeues the head and runs it via `runTurn` (bypassing model routing; using the model stored at enqueue time). This works for background (non-active) sessions too.

**Tech Stack:** React 18 + TypeScript, electron-vite, Tailwind v3, vitest, lucide-react icons.

---

## File Structure

**Modify:**
- `src/renderer/cli/types.ts` — add `QueuedMessage` interface.
- `src/renderer/mock/fixtures.ts` — add `queued?: QueuedMessage[]` to `Session`.
- `src/renderer/state/useSessions.ts` — add `enqueue` / `enqueueFront` / `removeQueued` / `updateQueued` actions + reducer cases. (No queue-clear on `closeSession` is needed — it removes the whole session, so the queue dies with it; the auto-flush effect skips non-open tabs so a soft-closed tab's queue never fires.)
- `src/renderer/state/useSessions.test.ts` — reducer tests for the new actions.
- `src/renderer/views/chat/Composer.tsx` — stop blocking on busy; Enter→enqueue, Ctrl+Enter→interrupt; render queue chips (edit/remove); new props.
- `src/renderer/views/chat/ChatView.tsx` — thread new props through to Composer.
- `src/renderer/App.tsx` — `enqueueMessage` / `removeQueued` / `interruptAndSend` handlers, the auto-flush `useEffect`, and wire props into `ChatView`.

**No new files** — the queue is small enough to live in the existing reducer + Composer.

---

## Task 1: `QueuedMessage` type + `Session.queued` field

**Files:**
- Modify: `src/renderer/cli/types.ts` (append near the other turn/message types)
- Modify: `src/renderer/mock/fixtures.ts:94-126` (Session interface)

- [ ] **Step 1: Add the `QueuedMessage` type**

In `src/renderer/cli/types.ts`, append after the `ImageAttachment` interface (around line 160+, at end of the turn-related types):

```ts
/**
 * A message the user typed while a turn was already running. Queued in FIFO
 * order on the session; flushed one-at-a-time as its own turn when the session
 * returns to 'idle'. `modelId`/`effort`/`images` are captured at enqueue time so
 * the queued send reproduces the model/effort/images the user composed (model
 * routing is intentionally bypassed for queued sends — the choice was already
 * made). Permission mode is NOT captured; the flush uses the session's current
 * permission mode (latest-wins), which is the desired behavior.
 */
export interface QueuedMessage {
  id: string
  text: string
  modelId: string
  effort?: Effort
  images?: ImageAttachment[]
}
```

- [ ] **Step 2: Add the `queued` field to `Session`**

In `src/renderer/mock/fixtures.ts`, add an import at the top alongside the other `@/cli/types` usage if not present, then add the field. First add the field inside `interface Session` (after `forkPending?` at line 125):

```ts
  /**
   * FIFO queue of messages the user typed while a turn was running. Flushed
   * one-at-a-time (each as its own turn) when this session goes back to 'idle'.
   * Transient UI state — not persisted via StoredSession.
   */
  queued?: import('@/cli/types').QueuedMessage[]
```

(Inline `import('...')` type avoids adding a top-level import line and keeps the diff to one spot.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no usages yet, just the new type + optional field).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/cli/types.ts src/renderer/mock/fixtures.ts
git commit -m "feat: add QueuedMessage type and Session.queued field"
```

---

## Task 2: Reducer actions — `enqueue` / `enqueueFront` / `removeQueued` / `updateQueued`

**Files:**
- Modify: `src/renderer/state/useSessions.ts:13-28` (action union), `:57-139` (reducer switch)
- Test: `src/renderer/state/useSessions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/state/useSessions.test.ts` inside the `describe('sessionsReducer', ...)` block:

```ts
  it('enqueue appends a queued message in FIFO order', () => {
    const s0 = stateWithSession('x')
    const s1 = sessionsReducer(s0, {
      type: 'enqueue', sessionId: 'x',
      message: { id: 'q1', text: 'first', modelId: 'opus-4-8' },
    })
    const s2 = sessionsReducer(s1, {
      type: 'enqueue', sessionId: 'x',
      message: { id: 'q2', text: 'second', modelId: 'opus-4-8' },
    })
    expect(s2.sessions[0].queued?.map((q) => q.id)).toEqual(['q1', 'q2'])
    // immutability: original untouched
    expect(s0.sessions[0].queued).toBeUndefined()
  })

  it('removeQueued drops the matching message by id', () => {
    const base = sessionsReducer(stateWithSession('x'), {
      type: 'enqueue', sessionId: 'x',
      message: { id: 'q1', text: 'a', modelId: 'opus-4-8' },
    })
    const withTwo = sessionsReducer(base, {
      type: 'enqueue', sessionId: 'x',
      message: { id: 'q2', text: 'b', modelId: 'opus-4-8' },
    })
    const after = sessionsReducer(withTwo, { type: 'removeQueued', sessionId: 'x', id: 'q1' })
    expect(after.sessions[0].queued?.map((q) => q.id)).toEqual(['q2'])
  })

  it('updateQueued edits the text of a queued message', () => {
    const base = sessionsReducer(stateWithSession('x'), {
      type: 'enqueue', sessionId: 'x',
      message: { id: 'q1', text: 'old', modelId: 'opus-4-8' },
    })
    const after = sessionsReducer(base, { type: 'updateQueued', sessionId: 'x', id: 'q1', text: 'new' })
    expect(after.sessions[0].queued?.[0].text).toBe('new')
  })

  it('removeQueued on an empty queue is a no-op (no throw)', () => {
    const s0 = stateWithSession('x')
    const after = sessionsReducer(s0, { type: 'removeQueued', sessionId: 'x', id: 'nope' })
    expect(after.sessions[0].queued ?? []).toEqual([])
  })

  it('enqueueFront inserts at the head (interrupt jumps the line)', () => {
    const withTwo = [
      { type: 'enqueue' as const, sessionId: 'x', message: { id: 'q1', text: 'a', modelId: 'opus-4-8' } },
      { type: 'enqueue' as const, sessionId: 'x', message: { id: 'q2', text: 'b', modelId: 'opus-4-8' } },
    ].reduce(sessionsReducer, stateWithSession('x'))
    const after = sessionsReducer(withTwo, {
      type: 'enqueueFront', sessionId: 'x',
      message: { id: 'q0', text: 'now', modelId: 'opus-4-8' },
    })
    expect(after.sessions[0].queued?.map((q) => q.id)).toEqual(['q0', 'q1', 'q2'])
  })

  it('removeQueued/updateQueued on an unknown session id is a no-op (no throw)', () => {
    const s0 = stateWithSession('x')
    expect(() => sessionsReducer(s0, { type: 'removeQueued', sessionId: 'nope', id: 'q1' })).not.toThrow()
    expect(() => sessionsReducer(s0, { type: 'updateQueued', sessionId: 'nope', id: 'q1', text: 't' })).not.toThrow()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/state/useSessions.test.ts`
Expected: FAIL — TypeScript/asserts on unknown action types `enqueue`/`removeQueued`/`updateQueued`.

- [ ] **Step 3: Add the action types to the union**

In `src/renderer/state/useSessions.ts`, add `QueuedMessage` to the existing type import on line 4 and extend the `SessionsAction` union (after line 28's `setArchived`):

Line 4 — change:
```ts
import type { StoredSession, TurnUsage } from '@/cli/types'
```
to:
```ts
import type { StoredSession, TurnUsage, QueuedMessage } from '@/cli/types'
```

Add to the `SessionsAction` union (after the `setArchived` line):
```ts
  | { type: 'enqueue'; sessionId: string; message: QueuedMessage }
  | { type: 'enqueueFront'; sessionId: string; message: QueuedMessage }
  | { type: 'removeQueued'; sessionId: string; id: string }
  | { type: 'updateQueued'; sessionId: string; id: string; text: string }
```

- [ ] **Step 4: Add the reducer cases**

In `src/renderer/state/useSessions.ts`, add these cases inside the `switch` (e.g. right before `case 'hydrate':` at line 119):

```ts
    case 'enqueue':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        queued: [...(s.queued ?? []), action.message],
      }))

    case 'enqueueFront':
      // Interrupt: this message must be sent FIRST, ahead of anything already queued.
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        queued: [action.message, ...(s.queued ?? [])],
      }))

    case 'removeQueued':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        queued: (s.queued ?? []).filter((q) => q.id !== action.id),
      }))

    case 'updateQueued':
      return patchSession(state, action.sessionId, (s) => ({
        ...s,
        queued: (s.queued ?? []).map((q) => (q.id === action.id ? { ...q, text: action.text } : q)),
      }))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/state/useSessions.test.ts`
Expected: PASS (all new tests + existing tests green).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/state/useSessions.ts src/renderer/state/useSessions.test.ts
git commit -m "feat: add enqueue/enqueueFront/removeQueued/updateQueued reducer actions"
```

---

## Task 3: Composer — queue on Enter, interrupt on Ctrl+Enter, render chips

**Files:**
- Modify: `src/renderer/views/chat/Composer.tsx`

- [ ] **Step 1: Extend `ComposerProps` and imports**

In `src/renderer/views/chat/Composer.tsx`, update the icon import (line 2) to add `ListPlus` and `Pencil`:

```ts
import { ArrowUp, Mic, GitBranch, Square, X, ListPlus, Pencil } from 'lucide-react'
```

Add `QueuedMessage` to the type import (line 12):
```ts
import type { Effort, PermissionMode, QueuedMessage } from '@/cli/types'
```

Add these fields to `interface ComposerProps` (after `onFork?` at line 46):
```ts
  /** Queued messages for this session (typed while a turn was running). */
  queued?: QueuedMessage[]
  /** Enqueue the current draft while busy (Enter while a turn runs). */
  onEnqueue?: (text: string, modelId: string, effort?: Effort, images?: Array<{ mediaType: string; data: string }>) => void
  /** Interrupt: stop the running turn and send the current draft now (Ctrl+Enter). */
  onInterrupt?: (text: string, modelId: string, effort?: Effort, images?: Array<{ mediaType: string; data: string }>) => void
  /** Remove a queued message by id (chip X button). */
  onRemoveQueued?: (id: string) => void
```

- [ ] **Step 2: Update the destructure + `submit`/`interrupt`/`enqueue` logic**

Change the function signature destructure (lines 54-56) to include the new props:
```ts
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { model, onSend, onStop, busy = false, tokens, permissionMode, onChangePermission, onSetCwd, onFork,
    queued = [], onEnqueue, onInterrupt, onRemoveQueued },
  ref,
): JSX.Element {
```

Replace the `submit` function (lines 78-86) with a version that routes to enqueue while busy, plus add `interrupt` and a shared `imagesPayload` helper:

```ts
  const imagesPayload = (): Array<{ mediaType: string; data: string }> | undefined =>
    images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined

  const clearDraft = (): void => {
    setValue('')
    setImages([])
    requestAnimationFrame(resize)
  }

  // While a turn is running, Enter queues the draft (auto-sent when the turn
  // finishes) instead of being blocked. When idle, it sends normally.
  const submit = (): void => {
    const text = value.trim()
    if (!text && images.length === 0) return
    if (busy) {
      if (!onEnqueue) return
      onEnqueue(text, modelId, effort, imagesPayload())
    } else {
      onSend(text, modelId, effort, imagesPayload())
    }
    clearDraft()
  }

  // Ctrl+Enter while busy: stop the running turn and send this draft immediately.
  const interrupt = (): void => {
    const text = value.trim()
    if (!text && images.length === 0) return
    if (!onInterrupt) return
    onInterrupt(text, modelId, effort, imagesPayload())
    clearDraft()
  }

  // Pull a queued message back into the textarea to edit it. ALWAYS remove it from
  // the queue first (unconditionally — not just while busy): if the session has
  // just gone idle, the auto-flush effect is about to send this very item, so
  // leaving it in the queue would double-send (once by flush, once on re-submit).
  const editQueued = (q: QueuedMessage): void => {
    onRemoveQueued?.(q.id)
    setValue((v) => (v ? `${q.text} ${v}` : q.text))
    setModelId(q.modelId)
    setEffort(q.effort)
    textareaRef.current?.focus()
    requestAnimationFrame(resize)
  }
```

- [ ] **Step 3: Update `handleKeyDown` for Ctrl+Enter and `canSend`**

Replace `handleKeyDown` (lines 118-123):
```ts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      // Ctrl/Cmd+Enter: interrupt the running turn and send now.
      e.preventDefault()
      if (busy) interrupt()
      else submit()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }
```

Replace `canSend` (line 125) so the button is enabled while busy (Enter now queues):
```ts
  const canSend = value.trim().length > 0 || images.length > 0
```

- [ ] **Step 4: Render the queue chips above the textarea**

In `src/renderer/views/chat/Composer.tsx`, inside the rounded composer container, immediately **before** the image-thumbnails block (before line 134's `{images.length > 0 && (`), insert:

```tsx
          {/* Queued messages (typed while a turn was running) */}
          {queued.length > 0 && (
            <ul className="flex flex-col gap-1 px-3 pt-2" aria-label={th ? 'คิวข้อความ' : 'Queued messages'}>
              {queued.map((q, i) => (
                <li
                  key={q.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-fg-muted"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[10px] text-accent">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => editQueued(q)}
                    title={th ? 'แก้ไขข้อความในคิว' : 'Edit queued message'}
                    aria-label={th ? `แก้ไขข้อความในคิวที่ ${i + 1}` : `Edit queued message ${i + 1}`}
                    className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                  >
                    <Pencil size={11} className="shrink-0" />
                    <span className="truncate">{q.text || (th ? '(รูปภาพ)' : '(image)')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveQueued?.(q.id)}
                    title={th ? 'ลบออกจากคิว' : 'Remove from queue'}
                    aria-label={th ? `ลบข้อความในคิวที่ ${i + 1}` : `Remove queued message ${i + 1}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-destructive/20 hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
```

- [ ] **Step 5: Update placeholder + send-button cluster (queue affordance while busy)**

Change the textarea placeholder (line 166) so it tells the user typing will queue:
```tsx
            placeholder={busy ? (th ? 'พิมพ์เพื่อต่อคิว…' : 'Type to queue…') : dictation.listening ? 'Listening…' : 'Message Claude…'}
```

Replace the right-side send/stop cluster (lines 212-237) so that while busy we show BOTH a Queue button (when there is draft text) and the Stop button; when idle, the normal Send button:

```tsx
              {busy ? (
                <>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!canSend}
                    title={th ? 'ต่อคิว (Enter) · แทรกทันที Ctrl+Enter' : 'Queue (Enter) · Ctrl+Enter to interrupt'}
                    aria-label={th ? 'ต่อคิวข้อความ' : 'Queue message'}
                    className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      canSend
                        ? 'bg-accent/80 hover:bg-accent text-white cursor-pointer'
                        : 'bg-surface-2 text-fg-muted cursor-not-allowed'
                    }`}
                  >
                    <ListPlus size={14} />
                  </button>
                  {onStop && (
                    <button
                      type="button"
                      onClick={onStop}
                      title={th ? 'หยุดการตอบ' : 'Stop generating'}
                      aria-label={th ? 'หยุดการตอบ' : 'Stop generating'}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-white transition-colors hover:bg-destructive/90 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Square size={13} fill="currentColor" />
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  title="Send message"
                  aria-label="Send message"
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    canSend
                      ? 'bg-accent hover:bg-accent-hover text-white cursor-pointer'
                      : 'bg-surface-2 text-fg-muted cursor-not-allowed'
                  }`}
                >
                  <ArrowUp size={14} />
                </button>
              )}
```

- [ ] **Step 6: Keep `ComposerHandle.submit` working (voice "ส่ง")**

The imperative `submit` exposed via `useImperativeHandle` (line 116) already calls the new `submit`, which now enqueues while busy — that is the correct behavior for the voice "ส่ง" command too (queues if busy, sends if idle). No change needed; verify line 116 still reads:
```ts
  useImperativeHandle(ref, () => ({ submit, setModel: setModelId, setEffort }))
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/views/chat/Composer.tsx
git commit -m "feat: queue/interrupt + queue chips in composer while busy"
```

---

## Task 4: ChatView — thread the new props through

**Files:**
- Modify: `src/renderer/views/chat/ChatView.tsx`

- [ ] **Step 1: Extend the props type + destructure**

In `src/renderer/views/chat/ChatView.tsx`, add `QueuedMessage` to the type import (line 4):
```ts
import type { Effort, PermissionMode, QueuedMessage } from '@/cli/types'
```

Add to the destructured params (after `onFork,` line 17) and to the inline props type (after `onFork?:` line 27):

Destructure block — add:
```ts
  queued,
  onEnqueue,
  onInterrupt,
  onRemoveQueued,
```

Props type block — add:
```ts
  queued?: QueuedMessage[]
  onEnqueue?: (text: string, modelId: string, effort?: Effort, images?: Array<{ mediaType: string; data: string }>) => void
  onInterrupt?: (text: string, modelId: string, effort?: Effort, images?: Array<{ mediaType: string; data: string }>) => void
  onRemoveQueued?: (id: string) => void
```

- [ ] **Step 2: Pass them to `<Composer>`**

Update the `<Composer ... />` JSX (lines 89-100) to forward the new props:
```tsx
      <Composer
        ref={composerRef}
        model={session.model}
        onSend={onSend}
        onStop={onStop}
        busy={session.status === 'running'}
        tokens={session.tokens}
        permissionMode={permissionMode}
        onChangePermission={onChangePermission}
        onSetCwd={onSetCwd}
        onFork={onFork}
        queued={queued}
        onEnqueue={onEnqueue}
        onInterrupt={onInterrupt}
        onRemoveQueued={onRemoveQueued}
      />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/views/chat/ChatView.tsx
git commit -m "feat: thread queue props through ChatView"
```

---

## Task 5: App.tsx — enqueue/remove/interrupt handlers + auto-flush effect

**Files:**
- Modify: `src/renderer/App.tsx` — add handlers near `handleStop` (line ~729), the flush `useEffect`, and wire props into `ChatView` (line ~868).

- [ ] **Step 1: Add the enqueue / removeQueued / interrupt handlers**

In `src/renderer/App.tsx`, immediately after `handleStop` (ends line 729), add:

```ts
  // Enqueue a message typed while THIS session's turn is running. It is flushed
  // (sent as its own turn) by the auto-flush effect when the session goes idle.
  const enqueueMessage = (
    text: string, modelId: string, effort?: Effort, images?: ImageAttachment[],
  ): void => {
    const sid = activeSession.id
    sessionsDispatch({
      type: 'enqueue', sessionId: sid,
      message: { id: nextId('q'), text, modelId, effort, images },
    })
    const n = (sessionsRef.current.find((s) => s.id === sid)?.queued?.length ?? 0) + 1
    speakStatus(say({ th: `เข้าคิวแล้ว ${n} ข้อความ`, en: `Queued (${n})` }))
  }

  const removeQueued = (id: string): void => {
    sessionsDispatch({ type: 'removeQueued', sessionId: activeSession.id, id })
    speakStatus(say({ th: 'ลบออกจากคิวแล้ว', en: 'Removed from queue' }))
  }

  // Interrupt = "send THIS now". Cancel the running turn (if any) and enqueue at
  // the HEAD (enqueueFront) so it jumps ahead of anything already queued — honoring
  // the design's "stop current + run now". The auto-flush effect sends it the moment
  // the session goes idle (the cancel's onDone flips status → 'idle'). We enqueue
  // rather than call runTurn directly because the cancel is async — a direct runTurn
  // would stack a second live turn on a still-'running' session.
  const interruptAndSend = (
    text: string, modelId: string, effort?: Effort, images?: ImageAttachment[],
  ): void => {
    const sess = activeSession
    if (sess.status === 'running') {
      const turnId = activeTurnFor(activeTurnsRef.current, sess.id)
      if (turnId) claudeClient.cancelTurn(turnId)
    }
    sessionsDispatch({
      type: 'enqueueFront', sessionId: sess.id,
      message: { id: nextId('q'), text, modelId, effort, images },
    })
    speakStatus(say(STATUS.stopped))
  }
```

> Note: `enqueueMessage` / `removeQueued` / `interruptAndSend` all target `activeSession` — by design you can only type into the *visible* composer, so enqueue is single-session. The auto-flush (Step 2), by contrast, is multi-session: a session you queued into and then switched away from (still an open tab, just not active) keeps running and flushes its queue when it finishes. That asymmetry is intentional.

- [ ] **Step 2: Add the auto-flush effect**

In `src/renderer/App.tsx`, add this effect. Place it right after the `pendingSeed` flush effect (after line 842, before `const centerView`):

```ts
  // Auto-flush queued messages: when ANY open session is idle with a non-empty
  // queue, dequeue the head and run it as its own turn. Works for background
  // sessions (the turn targets the queued session, not necessarily the active tab).
  //
  // Correctness invariants:
  // - Only `status === 'idle'` flushes. finishTurn always lands on 'idle' (never
  //   the unused 'error'/'active' states), and runTurn's error/cancel paths also
  //   finishTurn → 'idle', so an errored OR stopped turn still flushes the queue.
  // - dequeue (removeQueued) + runTurn's startTurn (status → 'running') are two
  //   dispatches in the same effect tick; React 18 (createRoot) auto-batches them
  //   into ONE commit, so the effect never re-observes the same head with status
  //   still 'idle' → no double-send. `break` = one flush per pass; FIFO across
  //   passes (next finishTurn → idle re-fires the effect for the following item).
  // - routePendingRef guard closes the routing race: if a normal send is mid-
  //   routing (classifier await / confirm dialog open) the session is still 'idle'
  //   but a runTurn is about to fire for it — flushing now would stack two turns.
  // - Skip non-open tabs: a soft-closed tab (closeTab → open:false) must not
  //   silently fire turns in the background.
  // Routing is bypassed for queued sends: the queued modelId is used as-is.
  useEffect(() => {
    if (!claudeOk) return
    if (routePendingRef.current) return
    for (const s of sessions) {
      if (s.status !== 'idle' || s.open === false) continue
      const head = s.queued?.[0]
      if (!head) continue
      sessionsDispatch({ type: 'removeQueued', sessionId: s.id, id: head.id })
      runTurn(s, head.text, head.modelId, head.effort, head.images)
      break // one flush per effect pass; the next idle render flushes the following item
    }
    // runTurn/sessions read fresh each render; guarded by status checks above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, claudeOk])
```

- [ ] **Step 3: Wire the new props into `<ChatView>`**

In `src/renderer/App.tsx`, update the `<ChatView ... />` JSX in `centerView` (lines 868-877) to pass the queue props:

```tsx
          <ChatView
            session={activeSession}
            onSend={handleSend}
            onStop={handleStop}
            composerRef={composerRef}
            permissionMode={permissionMode}
            onChangePermission={setPermissionMode}
            onSetCwd={(path) => sessionsDispatch({ type: 'setCwd', sessionId: activeSession.id, cwd: path })}
            onFork={(text) => forkSession(text)}
            queued={activeSession.queued ?? []}
            onEnqueue={enqueueMessage}
            onInterrupt={interruptAndSend}
            onRemoveQueued={removeQueued}
          />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (existing 17+ tests + 4 new reducer tests).

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build succeeds (electron-vite renderer + main).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: auto-flush queued messages + enqueue/interrupt handlers"
```

---

## Task 6: Manual verification (real Electron app)

**Files:** none (runtime verification).

- [ ] **Step 1: Run the app**

Run: `npm run dev` (or `launcher/start-dev.bat`)

- [ ] **Step 2: Verify queue (sighted)**

With Live mode + an installed `claude` CLI:
1. Send a long-running prompt (e.g. "list 20 facts about the ocean, one paragraph each").
2. While it streams, type "now summarize in one line" and press **Enter** → a chip appears above the composer; the turn keeps running.
3. Type a second message, Enter → second chip appears (numbered 1, 2).
4. When the first turn finishes, the chips flush one at a time, each as its own turn in order.

- [ ] **Step 3: Verify interrupt (Ctrl+Enter)**

1. Send a long prompt.
2. While streaming, type "stop, do X instead" and press **Ctrl+Enter** → the running turn stops and the new message sends as the next turn.

- [ ] **Step 4: Verify chip edit/remove**

1. Queue two messages.
2. Click a chip (pencil) → its text returns to the textarea, removed from the queue.
3. Click the X on a chip → it disappears from the queue.

- [ ] **Step 5: Verify a11y (blind UX)**

1. Eyes-closed: queue a message → hear "เข้าคิวแล้ว N ข้อความ" / "Queued (N)" in the selected voice.
2. Remove a chip → hear "ลบออกจากคิวแล้ว" / "Removed from queue".
3. Tab into the chip buttons → screen reader announces the aria-labels.

- [ ] **Step 6: Record results in HANDOFF.md**

Append a short verification note (date + what passed) under the relevant TODO item.

---

## Self-Review

**Spec coverage:**
- ✅ Queue one-at-a-time, separate turns, FIFO → Task 5 flush effect (`break` + idle-gated re-fire).
- ✅ Queue (Enter) + interrupt now (Ctrl+Enter) → Task 3 `submit`/`interrupt` + Task 5 `interruptAndSend` (jumps the line via `enqueueFront`).
- ✅ Chips with delete + edit → Task 3 chip list (`editQueued` removes unconditionally, `onRemoveQueued`).
- ✅ Works for background sessions → Task 5 effect iterates all OPEN `sessions`, targets `s` not `activeSession`.
- ✅ Bypass routing, stored modelId → Task 5 `runTurn(s, head.modelId, ...)`.
- ✅ A11y announce + aria-labels → Task 5 `speakStatus`, Task 3 chip `aria-label`s.
- ✅ Pure reducer tested → Task 2 (incl. `enqueueFront` head-insert + unknown-session no-op).
- ✅ Build/typecheck green → Tasks gate on `tsc --noEmit` + `npm run build` + `vitest run`.

**Type consistency:** `QueuedMessage { id, text, modelId, effort?, images? }` defined once (Task 1), used identically in reducer (Task 2), Composer (Task 3), ChatView (Task 4), App (Task 5). Action names `enqueue`/`enqueueFront`/`removeQueued`/`updateQueued` consistent across union + cases + dispatch sites.

**Placeholder scan:** none — every step shows full code.

**Review fixes folded in (spawned review, 2 reviewers):**
1. **Interrupt now honors "send now"** — added `enqueueFront` action; `interruptAndSend` inserts at head so it jumps ahead of already-queued items (was: tail-append, sent the wrong message first).
2. **`editQueued` double-send fixed** — removes from queue unconditionally (was: only `if (busy)`, which double-sent when clicked on a just-idle session as the flush effect also sent it).
3. **Flush-vs-routing race fixed** — flush effect early-returns while `routePendingRef.current` is set, so an interrupt during the model-routing window can't stack two turns on one session.
4. **Closed-tab queue no longer fires** — flush effect skips `open === false`; the File-Structure "clear queue on closeSession" line was moot (closeSession removes the whole session) and is corrected.
5. **`permissionMode` doc corrected** — `QueuedMessage` captures model/effort/images; permission mode is latest-wins (current), and the doc comment now says so instead of claiming an exact reproduction.
6. Added reducer tests for `enqueueFront` and the unknown-session no-op path.
