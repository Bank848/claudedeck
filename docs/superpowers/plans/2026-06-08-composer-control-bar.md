# Composer Control Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Composer's bottom row with a Claude-app-style control bar — Plus menu, Mode pill, Model pill, Effort pill, Usage ring — each reachable by mouse, keyboard, and voice.

**Architecture:** A shared `Pill` + `Popover` primitive (outside-click/Escape/roving-focus in one place) under five thin control components. Pure mapping helpers (`permissionModes.ts`, `effort.ts`, plus a `nextRovingIndex` helper) carry all the logic and get unit-tested; the React shells are verified manually. `permissionMode` stays in `App` (so `handleSend` keeps reading it) and is threaded down to the Composer; a new `setCwd` reducer action + an Electron directory-picker IPC back the "Add folder" item. Effort is a persisted UI-only setting, labelled as cosmetic.

**Tech Stack:** React 18, TypeScript, Tailwind, lucide-react, Electron IPC, Vitest. No new dependencies.

---

## File Structure

**New files**
- `src/renderer/settings/permissionModes.ts` — `PermissionMode` ↔ label/shortcut/voice mapping + `modeFromVoice`.
- `src/renderer/settings/permissionModes.test.ts` — totality + mapping tests.
- `src/renderer/settings/effort.ts` — `EffortLevel`, options, label/stop/voice mappings, default.
- `src/renderer/settings/effort.test.ts` — mapping + stop round-trip tests.
- `src/renderer/components/Pill.tsx` — `Pill` trigger, `Popover` panel, `usePopover` hook, `nextRovingIndex` helper.
- `src/renderer/components/Pill.test.ts` — `nextRovingIndex` pure tests.
- `src/renderer/components/controls/ModePicker.tsx`
- `src/renderer/components/controls/EffortPicker.tsx`
- `src/renderer/components/controls/UsagePill.tsx`
- `src/renderer/components/controls/PlusMenu.tsx`
- `src/renderer/system/pickDirectory.ts` — renderer wrapper over the directory-picker IPC.

**Modified files**
- `electron/main.ts` — `app:pick-directory` IPC (uses `dialog`).
- `electron/preload.ts` — `app.pickDirectory()` on the bridge.
- `src/renderer/state/useSessions.ts` — `setCwd` action.
- `src/renderer/state/useSessions.test.ts` — `setCwd` test.
- `src/renderer/settings/SettingsContext.tsx` — `effort` setting + default.
- `src/renderer/components/ModelPicker.tsx` — number shortcuts + roving focus + shared Popover close.
- `src/renderer/views/chat/Composer.tsx` — assemble the control bar; `ComposerHandle.setModel`; new props.
- `src/renderer/views/chat/ChatView.tsx` — thread new props through.
- `src/renderer/App.tsx` — pass `permissionMode`/`setPermissionMode`/`onSetCwd` to ChatView; mode/effort/model voice commands.
- `src/renderer/layout/StatusBar.tsx` — remove the mode `<select>` (keep Live/Mock + read-only info).
- `src/renderer/settings/voiceCommands.test.ts` — mode/effort voice resolution.

---

## Task 1: Permission-mode mapping helper

**Files:**
- Create: `src/renderer/settings/permissionModes.ts`
- Test: `src/renderer/settings/permissionModes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/settings/permissionModes.test.ts
import { describe, it, expect } from 'vitest'
import type { PermissionMode } from '@/cli/types'
import { MODE_OPTIONS, modeLabel, modeFromVoice } from './permissionModes'

describe('permissionModes', () => {
  it('covers exactly the four CLI permission modes, each with a unique 1..4 shortcut', () => {
    const modes = MODE_OPTIONS.map((o) => o.mode).sort()
    expect(modes).toEqual(['acceptEdits', 'bypassPermissions', 'default', 'plan'])
    expect(MODE_OPTIONS.map((o) => o.shortcut).sort()).toEqual([1, 2, 3, 4])
  })

  it('modeLabel is total over PermissionMode', () => {
    const all: PermissionMode[] = ['plan', 'acceptEdits', 'bypassPermissions', 'default']
    for (const m of all) expect(modeLabel(m).length).toBeGreaterThan(0)
  })

  it('modeFromVoice matches TH + EN phrases, longest phrase wins', () => {
    expect(modeFromVoice('โหมดวางแผน')).toBe('plan')
    expect(modeFromVoice('please accept edits now')).toBe('acceptEdits')
    expect(modeFromVoice('บายพาส')).toBe('bypassPermissions')
    expect(modeFromVoice('ask permissions')).toBe('default')
    expect(modeFromVoice('สวัสดี')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/renderer/settings/permissionModes.test.ts`
Expected: FAIL — `Cannot find module './permissionModes'`.

- [ ] **Step 3: Implement**

```ts
// src/renderer/settings/permissionModes.ts
import type { PermissionMode } from '@/cli/types'

export interface ModeOption {
  mode: PermissionMode
  /** Claude-app-style label. */
  label: string
  /** Number-key shortcut shown in the popover (1..4). */
  shortcut: number
  /** TH + EN voice phrases (lowercase). */
  phrases: string[]
}

export const MODE_OPTIONS: ModeOption[] = [
  { mode: 'default', label: 'Ask permissions', shortcut: 1, phrases: ['ask permissions', 'ask mode', 'โหมดถาม', 'ถามก่อน'] },
  { mode: 'acceptEdits', label: 'Accept edits', shortcut: 2, phrases: ['accept edits', 'allow edits', 'ยอมรับการแก้ไข', 'ยอมรับแก้ไข', 'อนุญาตแก้ไข'] },
  { mode: 'plan', label: 'Plan mode', shortcut: 3, phrases: ['plan mode', 'read only', 'โหมดวางแผน', 'อ่านอย่างเดียว'] },
  { mode: 'bypassPermissions', label: 'Bypass permissions', shortcut: 4, phrases: ['bypass permissions', 'bypass', 'โหมดบายพาส', 'บายพาส', 'ข้ามสิทธิ์'] },
]

export function modeLabel(mode: PermissionMode): string {
  return MODE_OPTIONS.find((o) => o.mode === mode)?.label ?? mode
}

/** Longest matching phrase wins (mirrors voiceCommands.dispatchCommand). */
export function modeFromVoice(text: string): PermissionMode | null {
  const t = text.toLowerCase()
  let best: PermissionMode | null = null
  let len = 0
  for (const o of MODE_OPTIONS) {
    for (const p of o.phrases) {
      if (t.includes(p) && p.length > len) {
        best = o.mode
        len = p.length
      }
    }
  }
  return best
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/renderer/settings/permissionModes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings/permissionModes.ts src/renderer/settings/permissionModes.test.ts
git commit -F - <<'EOF'
feat(composer): permission-mode label/shortcut/voice mapping helper
EOF
```

---

## Task 2: Effort mapping helper

**Files:**
- Create: `src/renderer/settings/effort.ts`
- Test: `src/renderer/settings/effort.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/settings/effort.test.ts
import { describe, it, expect } from 'vitest'
import {
  EFFORT_OPTIONS, DEFAULT_EFFORT, effortLabel, effortToStop, effortFromStop, effortFromVoice,
  type EffortLevel,
} from './effort'

describe('effort', () => {
  it('has 3 stops indexed 0..2 with the default in the middle', () => {
    expect(EFFORT_OPTIONS.map((e) => e.stop)).toEqual([0, 1, 2])
    expect(DEFAULT_EFFORT).toBe('medium')
    expect(effortToStop(DEFAULT_EFFORT)).toBe(1)
  })

  it('stop <-> level round-trips', () => {
    const levels: EffortLevel[] = ['faster', 'medium', 'smarter']
    for (const l of levels) expect(effortFromStop(effortToStop(l))).toBe(l)
    expect(effortLabel('smarter')).toBe('Smarter')
  })

  it('effortFromVoice matches TH + EN, longest phrase wins', () => {
    expect(effortFromVoice('เอฟฟอร์ตเร็ว')).toBe('faster')
    expect(effortFromVoice('make it smarter please')).toBe('smarter')
    expect(effortFromVoice('ปานกลาง')).toBe('medium')
    expect(effortFromVoice('สวัสดี')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/renderer/settings/effort.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/renderer/settings/effort.ts
export type EffortLevel = 'faster' | 'medium' | 'smarter'

export interface EffortOption {
  level: EffortLevel
  label: string
  /** Slider stop index (0 = Faster … 2 = Smarter). */
  stop: number
  /** TH + EN voice phrases (lowercase). */
  phrases: string[]
}

export const EFFORT_OPTIONS: EffortOption[] = [
  { level: 'faster', label: 'Faster', stop: 0, phrases: ['effort faster', 'faster', 'เอฟฟอร์ตเร็ว', 'เร็ว'] },
  { level: 'medium', label: 'Medium', stop: 1, phrases: ['effort medium', 'medium effort', 'เอฟฟอร์ตกลาง', 'ปานกลาง'] },
  { level: 'smarter', label: 'Smarter', stop: 2, phrases: ['effort smarter', 'smarter', 'เอฟฟอร์ตฉลาด', 'ฉลาด'] },
]

export const DEFAULT_EFFORT: EffortLevel = 'medium'

export function effortLabel(level: EffortLevel): string {
  return EFFORT_OPTIONS.find((e) => e.level === level)?.label ?? level
}
export function effortToStop(level: EffortLevel): number {
  return EFFORT_OPTIONS.find((e) => e.level === level)?.stop ?? 1
}
export function effortFromStop(stop: number): EffortLevel {
  return EFFORT_OPTIONS.find((e) => e.stop === stop)?.level ?? DEFAULT_EFFORT
}
export function effortFromVoice(text: string): EffortLevel | null {
  const t = text.toLowerCase()
  let best: EffortLevel | null = null
  let len = 0
  for (const o of EFFORT_OPTIONS) {
    for (const p of o.phrases) {
      if (t.includes(p) && p.length > len) {
        best = o.level
        len = p.length
      }
    }
  }
  return best
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/renderer/settings/effort.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings/effort.ts src/renderer/settings/effort.test.ts
git commit -F - <<'EOF'
feat(composer): effort level mapping helper (cosmetic UI setting)
EOF
```

---

## Task 3: Persist `effort` in settings

**Files:**
- Modify: `src/renderer/settings/SettingsContext.tsx`

- [ ] **Step 1: Add the field to the `Settings` interface**

In `src/renderer/settings/SettingsContext.tsx`, add an import at the top (after the existing imports):

```ts
import type { EffortLevel } from './effort'
import { DEFAULT_EFFORT } from './effort'
```

Add to the `Settings` interface (after `uiScale: UiScale`):

```ts
  /** Reasoning-effort UI preference. Cosmetic — does NOT change CLI behavior. */
  effort: EffortLevel
```

- [ ] **Step 2: Add the default**

In `DEFAULTS`, after `uiScale: 'normal',`:

```ts
  effort: DEFAULT_EFFORT,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (The persistence round-trip is already handled generically by `load()`/the persist effect — no new code needed.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/settings/SettingsContext.tsx
git commit -F - <<'EOF'
feat(settings): persist cosmetic effort preference (default medium)
EOF
```

---

## Task 4: `nextRovingIndex` helper + Pill/Popover primitive

**Files:**
- Create: `src/renderer/components/Pill.tsx`
- Test: `src/renderer/components/Pill.test.ts`

- [ ] **Step 1: Write the failing test (pure keyboard helper)**

```ts
// src/renderer/components/Pill.test.ts
import { describe, it, expect } from 'vitest'
import { nextRovingIndex } from './Pill'

describe('nextRovingIndex', () => {
  it('wraps with ArrowDown/ArrowUp', () => {
    expect(nextRovingIndex(0, 3, 'ArrowDown')).toBe(1)
    expect(nextRovingIndex(2, 3, 'ArrowDown')).toBe(0)
    expect(nextRovingIndex(0, 3, 'ArrowUp')).toBe(2)
  })
  it('jumps with Home/End and ignores other keys', () => {
    expect(nextRovingIndex(1, 3, 'Home')).toBe(0)
    expect(nextRovingIndex(1, 3, 'End')).toBe(2)
    expect(nextRovingIndex(1, 3, 'a')).toBe(1)
  })
  it('returns -1 for an empty list', () => {
    expect(nextRovingIndex(0, 0, 'ArrowDown')).toBe(-1)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/renderer/components/Pill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the primitive**

```tsx
// src/renderer/components/Pill.tsx
import { forwardRef, useEffect, useRef, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/** Pure roving-focus index math (arrow/Home/End), wraps; -1 when empty. */
export function nextRovingIndex(current: number, count: number, key: string): number {
  if (count === 0) return -1
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return current
  }
}

/**
 * Close `open` on outside-mousedown or Escape. `ref` must wrap BOTH the trigger
 * and the popover so clicks inside either are treated as "inside".
 */
export function usePopover(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, ref])
}

interface PillProps {
  label: string
  icon?: ReactNode
  open: boolean
  onToggle: () => void
  ariaLabel: string
  /** ARIA popup role of the panel this pill controls. */
  haspopup: 'menu' | 'listbox' | 'dialog'
  /** Hide the chevron (e.g. the icon-only Plus pill). */
  chevron?: boolean
}

export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  { label, icon, open, onToggle, ariaLabel, haspopup, chevron = true },
  ref,
): JSX.Element {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-haspopup={haspopup}
      aria-expanded={open}
      aria-label={ariaLabel}
      className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {icon}
      {label && <span className="text-fg">{label}</span>}
      {chevron && <ChevronDown size={11} />}
    </button>
  )
})

interface PopoverProps {
  role: 'menu' | 'listbox' | 'dialog'
  ariaLabel: string
  children: ReactNode
  /** Tailwind width class, e.g. "w-64". */
  width?: string
}

/** Upward-opening panel (bottom bar). Caller owns open/close + focus. */
export function Popover({ role, ariaLabel, children, width = 'w-64' }: PopoverProps): JSX.Element {
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={`absolute bottom-full left-0 z-50 mb-2 ${width} overflow-hidden rounded-lg border border-border bg-surface shadow-xl`}
    >
      {children}
    </div>
  )
}

/** Focus the first `[data-roving]` item in a popover once it mounts. */
export function useAutoFocusFirst(open: boolean, panelRef: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    if (!open) return
    const first = panelRef.current?.querySelector<HTMLElement>('[data-roving]')
    first?.focus()
  }, [open, panelRef])
}

export const _internal = { useRef } // keep tree-shake honest; no-op
```

> Note: remove the `_internal` line if your lint flags unused — it exists only to keep `useRef` imported should a later edit need it; delete if unused.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/renderer/components/Pill.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck (drop unused import if flagged)**

Run: `npx tsc --noEmit`
If `useRef`/`_internal` is unused-flagged, delete the `import ... useRef` token and the `export const _internal` line.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/Pill.tsx src/renderer/components/Pill.test.ts
git commit -F - <<'EOF'
feat(composer): shared Pill + Popover primitive (outside-click/Escape/roving)
EOF
```

---

## Task 5: Directory-picker IPC (main + preload + renderer wrapper)

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Create: `src/renderer/system/pickDirectory.ts`

- [ ] **Step 1: Add `dialog` to the main import**

In `electron/main.ts` line 1, change:

```ts
import { app, shell, BrowserWindow, ipcMain } from 'electron'
```
to:
```ts
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
```

- [ ] **Step 2: Register the IPC handler**

In `registerIpc()`, right after the `app:open-external` handler (line ~217), add:

```ts
  ipcMain.handle('app:pick-directory', async (): Promise<string | null> => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose working directory',
      properties: ['openDirectory'],
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
```

- [ ] **Step 3: Expose it on the preload bridge**

In `electron/preload.ts`, inside the `app:` object (after `openExternal`), add:

```ts
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('app:pick-directory'),
```

- [ ] **Step 4: Renderer wrapper**

```ts
// src/renderer/system/pickDirectory.ts
/** Open the native directory picker. Returns the chosen path, or null if cancelled. */
export async function pickDirectory(): Promise<string | null> {
  return (await window.claudedeck?.app.pickDirectory?.()) ?? null
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. `window.claudedeck` is typed via the existing global declaration (it resolves `app.pickDirectory` from `ClaudeDeckApi`). If `tsc` reports `pickDirectory` missing on the type, open `src/renderer/env.d.ts` and confirm `claudedeck?: ClaudeDeckApi` (or equivalent) is declared — it should pick up the new method automatically since the bridge is typed `typeof api`.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/preload.ts src/renderer/system/pickDirectory.ts
git commit -F - <<'EOF'
feat(electron): app:pick-directory IPC + renderer wrapper for Add folder
EOF
```

---

## Task 6: `setCwd` reducer action

**Files:**
- Modify: `src/renderer/state/useSessions.ts`
- Test: `src/renderer/state/useSessions.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/state/useSessions.test.ts` (inside the existing top-level `describe`, or append a new one — match the file's existing import of `sessionsReducer`/`initialSessionsState`):

```ts
import { describe, it, expect } from 'vitest'
import { sessionsReducer, initialSessionsState } from './useSessions'

describe('setCwd', () => {
  it('updates only the target session cwd', () => {
    const s0 = initialSessionsState()
    const id = s0.sessions[0].id
    const otherCwd = s0.sessions[1].cwd
    const s1 = sessionsReducer(s0, { type: 'setCwd', sessionId: id, cwd: 'D:/new/path' })
    expect(s1.sessions[0].cwd).toBe('D:/new/path')
    expect(s1.sessions[1].cwd).toBe(otherCwd)
  })
})
```

> If `useSessions.test.ts` already imports these symbols, do NOT duplicate the imports — add only the new `describe` block.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/renderer/state/useSessions.test.ts`
Expected: FAIL — TS/assertion error: `'setCwd'` is not assignable to `SessionsAction`.

- [ ] **Step 3: Implement**

In `src/renderer/state/useSessions.ts`, add to the `SessionsAction` union:

```ts
  | { type: 'setCwd'; sessionId: string; cwd: string }
```

Add a case in `sessionsReducer` (before `default:`):

```ts
    case 'setCwd':
      return patchSession(state, action.sessionId, (s) => ({ ...s, cwd: action.cwd }))
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/renderer/state/useSessions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/useSessions.ts src/renderer/state/useSessions.test.ts
git commit -F - <<'EOF'
feat(state): setCwd action so Add folder can retarget the session cwd
EOF
```

---

## Task 7: `ModePicker` control

**Files:**
- Create: `src/renderer/components/controls/ModePicker.tsx`

- [ ] **Step 1: Implement the control**

```tsx
// src/renderer/components/controls/ModePicker.tsx
import { useRef, useState } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import type { PermissionMode } from '@/cli/types'
import { MODE_OPTIONS, modeLabel } from '@/settings/permissionModes'
import { Pill, Popover, usePopover, nextRovingIndex } from '../Pill'

interface ModePickerProps {
  value: PermissionMode
  onChange: (mode: PermissionMode) => void
}

export function ModePicker({ value, onChange }: ModePickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const pick = (mode: PermissionMode): void => {
    onChange(mode)
    close()
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive((i) => nextRovingIndex(i, MODE_OPTIONS.length, e.key))
    } else if (/^[1-9]$/.test(e.key)) {
      const opt = MODE_OPTIONS.find((o) => o.shortcut === Number(e.key))
      if (opt) pick(opt.mode)
    } else if (e.key === 'Enter') {
      pick(MODE_OPTIONS[active].mode)
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Pill
        ref={triggerRef}
        icon={<ShieldCheck size={12} className="text-accent" />}
        label={modeLabel(value)}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        ariaLabel={`Permission mode: ${modeLabel(value)}. Activate to change.`}
        haspopup="listbox"
      />
      {open && (
        <Popover role="listbox" ariaLabel="Permission mode" width="w-56">
          <ul className="py-1" onKeyDown={onKeyDown}>
            {MODE_OPTIONS.map((o, i) => (
              <li key={o.mode}>
                <button
                  type="button"
                  role="option"
                  data-roving
                  aria-selected={o.mode === value}
                  tabIndex={i === active ? 0 : -1}
                  onFocus={() => setActive(i)}
                  onClick={() => pick(o.mode)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    o.mode === value ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2'
                  }`}
                >
                  <span className="w-4 text-center font-mono text-xs text-fg-muted">{o.shortcut}</span>
                  <span className="flex-1">{o.label}</span>
                  {o.mode === value && <Check size={14} className="text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/controls/ModePicker.tsx
git commit -F - <<'EOF'
feat(composer): ModePicker pill (4 CLI permission modes, keyboard + shortcuts)
EOF
```

---

## Task 8: `EffortPicker` control

**Files:**
- Create: `src/renderer/components/controls/EffortPicker.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/renderer/components/controls/EffortPicker.tsx
import { useRef, useState } from 'react'
import { Gauge } from 'lucide-react'
import type { EffortLevel } from '@/settings/effort'
import { EFFORT_OPTIONS, effortLabel, effortToStop, effortFromStop } from '@/settings/effort'
import { Pill, Popover, usePopover } from '../Pill'

interface EffortPickerProps {
  value: EffortLevel
  onChange: (level: EffortLevel) => void
}

export function EffortPicker({ value, onChange }: EffortPickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)

  return (
    <div className="relative" ref={wrapRef}>
      <Pill
        ref={triggerRef}
        icon={<Gauge size={12} className="text-accent" />}
        label={effortLabel(value)}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        ariaLabel={`Effort: ${effortLabel(value)}. Display preference only.`}
        haspopup="dialog"
      />
      {open && (
        <Popover role="dialog" ariaLabel="Reasoning effort" width="w-64">
          <div className="space-y-3 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-fg-muted">Faster</span>
              <span className="font-medium text-fg">{effortLabel(value)}</span>
              <span className="text-fg-muted">Smarter</span>
            </div>
            <input
              type="range"
              min={0}
              max={EFFORT_OPTIONS.length - 1}
              step={1}
              value={effortToStop(value)}
              onChange={(e) => onChange(effortFromStop(Number(e.target.value)))}
              aria-label="Reasoning effort"
              aria-valuetext={effortLabel(value)}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-accent"
            />
            <p className="text-[11px] leading-snug text-fg-muted">
              Display preference only — does not change CLI output today.
            </p>
          </div>
        </Popover>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/controls/EffortPicker.tsx
git commit -F - <<'EOF'
feat(composer): EffortPicker slider pill (labelled cosmetic)
EOF
```

---

## Task 9: `UsagePill` control (context ring)

**Files:**
- Create: `src/renderer/components/controls/UsagePill.tsx`

Context-window limit constant lives in this file. Opus context = 200k tokens; use that as the denominator.

- [ ] **Step 1: Implement**

```tsx
// src/renderer/components/controls/UsagePill.tsx
import { useRef, useState } from 'react'
import { USAGE } from '@/mock/fixtures'
import { Pill, Popover, usePopover } from '../Pill'

/** Claude context-window size (tokens) used as the ring denominator. */
const CONTEXT_LIMIT = 200_000

function pct(used: number, limit: number): number {
  return Math.min(100, Math.round((used / limit) * 100))
}

interface UsagePillProps {
  /** Cumulative tokens for the active session. */
  tokens: number
}

export function UsagePill({ tokens }: UsagePillProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)

  const ctxPct = pct(tokens, CONTEXT_LIMIT)
  const ring = `conic-gradient(var(--color-accent, #D97757) ${ctxPct * 3.6}deg, var(--color-surface-2, #252931) 0deg)`
  const claude = USAGE.providers.find((p) => p.provider === 'claude')

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Context window ${ctxPct} percent used. Open usage details.`}
        title={`Context: ${ctxPct}%`}
        className="flex h-6 w-6 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: ring }}>
          <span className="h-2.5 w-2.5 rounded-full bg-surface" />
        </span>
      </button>
      {open && (
        <Popover role="dialog" ariaLabel="Usage" width="w-72">
          <div className="space-y-3 p-3 text-xs">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-fg">Context window</span>
                <span className="font-mono text-fg-muted">
                  {tokens.toLocaleString()} / {CONTEXT_LIMIT.toLocaleString()} ({ctxPct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${ctxPct}%` }} />
              </div>
            </div>
            {claude && (
              <div className="space-y-1.5 border-t border-border pt-2">
                <span className="font-medium text-fg">Plan usage</span>
                {claude.windows.map((w) => (
                  <div key={w.id} className="flex items-center justify-between text-fg-muted">
                    <span>{w.label}</span>
                    <span className="font-mono">
                      {pct(w.used, w.limit)}% · resets {w.resetsIn}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-fg-muted opacity-70">Plan figures are sample data.</p>
          </div>
        </Popover>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `--color-accent`/`--color-surface-2` CSS vars don't exist, the inline fallbacks `#D97757`/`#252931` are used — verify the ring renders during manual verify and swap to the real token vars from `theme/tokens.css` if needed.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/controls/UsagePill.tsx
git commit -F - <<'EOF'
feat(composer): UsagePill context ring + plan-usage popover (read-only)
EOF
```

---

## Task 10: `PlusMenu` control

**Files:**
- Create: `src/renderer/components/controls/PlusMenu.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/renderer/components/controls/PlusMenu.tsx
import { useRef, useState } from 'react'
import { Plus, FolderPlus, Slash, Image, Plug, Puzzle, ChevronRight } from 'lucide-react'
import { Pill, Popover, usePopover } from '../Pill'
import { pickDirectory } from '@/system/pickDirectory'

interface PlusMenuProps {
  /** Insert "/" into the composer and focus it. */
  onSlash: () => void
  /** Set the active session cwd to a chosen directory. */
  onPickFolder: (path: string) => void
}

export function PlusMenu({ onSlash, onPickFolder }: PlusMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopover(open, () => setOpen(false), wrapRef)

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const addFolder = async (): Promise<void> => {
    const path = await pickDirectory()
    if (path) onPickFolder(path)
    close()
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Pill
        ref={triggerRef}
        icon={<Plus size={14} />}
        label=""
        open={open}
        onToggle={() => setOpen((o) => !o)}
        ariaLabel="Add to conversation"
        haspopup="menu"
        chevron={false}
      />
      {open && (
        <Popover role="menu" ariaLabel="Add to conversation" width="w-60">
          <ul className="py-1 text-sm">
            <MenuRow disabled icon={<Image size={14} />} label="Add files or photos" hint="Ctrl+U" title="Coming soon" />
            <MenuRow icon={<FolderPlus size={14} />} label="Add folder" onClick={() => void addFolder()} />
            <MenuRow
              icon={<Slash size={14} />}
              label="Slash commands"
              onClick={() => {
                onSlash()
                close()
              }}
            />
            <div className="my-1 border-t border-border" />
            <MenuRow disabled icon={<Plug size={14} />} label="Connectors" caret title="Coming soon" />
            <MenuRow disabled icon={<Puzzle size={14} />} label="Plugins" caret title="Coming soon" />
          </ul>
        </Popover>
      )}
    </div>
  )
}

function MenuRow({
  icon, label, hint, caret, disabled, title, onClick,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  caret?: boolean
  disabled?: boolean
  title?: string
  onClick?: () => void
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        data-roving={disabled ? undefined : true}
        disabled={disabled}
        title={title}
        onClick={onClick}
        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
          disabled ? 'cursor-not-allowed text-fg-muted opacity-50' : 'text-fg hover:bg-surface-2'
        }`}
      >
        <span className="text-fg-muted">{icon}</span>
        <span className="flex-1">{label}</span>
        {hint && <span className="font-mono text-[11px] text-fg-muted">{hint}</span>}
        {caret && <ChevronRight size={13} className="text-fg-muted" />}
      </button>
    </li>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/controls/PlusMenu.tsx
git commit -F - <<'EOF'
feat(composer): PlusMenu (Add folder + Slash real; files/connectors/plugins stub)
EOF
```

---

## Task 11: Enhance `ModelPicker` (number shortcuts + roving + shared close)

**Files:**
- Modify: `src/renderer/components/ModelPicker.tsx`

Keep all existing behavior (provider icons, add-assistant, remove, checkmark). Adopt the shared `usePopover` close and add `1..N` number-shortcut selection + arrow roving over the model rows.

- [ ] **Step 1: Swap the hand-rolled outside-click for `usePopover`**

Replace the import line 1-2 region — add to the existing imports:

```ts
import { Pill, usePopover, nextRovingIndex } from './Pill'
```

Delete the `useEffect` block (lines ~32-42) that adds the `mousedown` listener, and replace with:

```ts
  usePopover(open, () => { setOpen(false); setAdding(false) }, ref)
```

(Place it right after the `const selected = ...` line. Keep `useEffect`/`useState`/`useRef` imports only if still used elsewhere — `tsc` will tell you; remove `useEffect` from the import if now unused.)

- [ ] **Step 2: Add roving + number-shortcut state and handler**

After `const selected = ...`, add:

```ts
  const [active, setActive] = useState(0)
  const onListKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive((i) => nextRovingIndex(i, all.length, e.key))
    } else if (/^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1
      if (idx < all.length) {
        onChange(all[idx].id)
        setOpen(false)
      }
    } else if (e.key === 'Enter' && all[active]) {
      onChange(all[active].id)
      setOpen(false)
    }
  }
```

- [ ] **Step 3: Wire the handler + shortcut digits into the list**

On the `<div className="max-h-72 overflow-y-auto py-1">` wrapper, add `onKeyDown={onListKeyDown}`.

In the `.map((m) => ...)` call, change to `.map((m, i) => ...)` and pass `index={i}` + `active={i === active}` to `ModelRow`. Update `ModelRow`'s props/signature to accept and render a leading shortcut number `{index + 1}` (only for `index < 9`) and `tabIndex={active ? 0 : -1}` + `data-roving` + `onFocus={() => /* parent setActive */}`. Concretely, extend `ModelRow`:

```tsx
function ModelRow({
  model, selected, removable, index, active, onSelect, onRemove, onFocus,
}: {
  model: ModelOption
  selected: boolean
  removable: boolean
  index: number
  active: boolean
  onSelect: () => void
  onRemove: () => void
  onFocus: () => void
}): JSX.Element {
  return (
    <div className={`group flex items-center gap-2 px-2 ${selected ? 'bg-surface-2' : 'hover:bg-surface-2'}`}>
      <button
        type="button"
        role="option"
        data-roving
        aria-selected={selected}
        tabIndex={active ? 0 : -1}
        onFocus={onFocus}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
      >
        <span className="w-4 text-center font-mono text-[11px] text-fg-muted">{index < 9 ? index + 1 : ''}</span>
        <ProviderIcon provider={model.provider} size={14} />
        <span className="min-w-0">
          <span className="block truncate text-sm text-fg">{model.label}</span>
          {model.sublabel && <span className="block truncate text-xs text-fg-muted">{model.sublabel}</span>}
        </span>
      </button>
      {selected && <Check size={14} className="shrink-0 text-accent" />}
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${model.label}`}
          className="shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}
```

And the call site:

```tsx
{all.map((m, i) => (
  <ModelRow
    key={m.id}
    model={m}
    index={i}
    active={i === active}
    selected={m.id === selected.id}
    removable={custom.some((c) => c.id === m.id)}
    onFocus={() => setActive(i)}
    onSelect={() => { onChange(m.id); setOpen(false) }}
    onRemove={() => remove(m.id)}
  />
))}
```

> The trigger button can stay as-is (it already has `aria-haspopup="listbox"`/`aria-expanded`). Adopting `Pill` for it is optional — leave the existing trigger to minimize regression risk.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify the B2 model→CLI guard still holds**

Run: `npx vitest run electron/claude.test.ts`
Expected: PASS (existing `toCliModel` tests unaffected — no metadata change to the offered rows).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ModelPicker.tsx
git commit -F - <<'EOF'
feat(composer): ModelPicker number shortcuts + roving focus + shared close
EOF
```

---

## Task 12: Assemble the control bar in `Composer` + thread props

**Files:**
- Modify: `src/renderer/views/chat/Composer.tsx`
- Modify: `src/renderer/views/chat/ChatView.tsx`

- [ ] **Step 1: Extend `ComposerProps` + `ComposerHandle`**

In `Composer.tsx`, update the imports:

```ts
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ArrowUp, Mic } from 'lucide-react'
import { ModelPicker } from '@/components/ModelPicker'
import { ModePicker } from '@/components/controls/ModePicker'
import { EffortPicker } from '@/components/controls/EffortPicker'
import { UsagePill } from '@/components/controls/UsagePill'
import { PlusMenu } from '@/components/controls/PlusMenu'
import { useSettings } from '@/settings/SettingsContext'
import { useDictation } from '@/settings/speechRecognition'
import { resolveLang } from '@/settings/speech'
import { MODELS } from '@/mock/fixtures'
import type { PermissionMode } from '@/cli/types'
```

Extend the handle + props:

```ts
export interface ComposerHandle {
  /** Submit the current text programmatically (used by the "ส่ง" voice command). */
  submit: () => void
  /** Set the model by id (used by the "โมเดล …" voice command). */
  setModel: (id: string) => void
}

interface ComposerProps {
  model: string
  onSend: (text: string, modelId: string) => void
  busy?: boolean
  /** Active session token count (for the usage ring). */
  tokens: number
  /** Permission mode (lifted from App, still read by App.handleSend). */
  permissionMode: PermissionMode
  onChangePermission: (mode: PermissionMode) => void
  /** Retarget the active session cwd (Add folder). */
  onSetCwd: (path: string) => void
}
```

- [ ] **Step 2: Read effort + expose `setModel` + slash handler**

Inside the component, after `const { settings } = useSettings()` change to `const { settings, update } = useSettings()`. After `const [modelId, setModelId] = useState(...)`:

```ts
  useImperativeHandle(ref, () => ({ submit, setModel: setModelId }))
```

Remove the old `useImperativeHandle(ref, () => ({ submit }))` line (replace it with the one above; it must come after `submit` is defined — keep it at the same position the original was, i.e. after `const submit = ...`).

Add a slash handler near `submit`:

```ts
  const insertSlash = (): void => {
    setValue((v) => (v.startsWith('/') ? v : `/${v}`))
    const el = textareaRef.current
    el?.focus()
    requestAnimationFrame(resize)
  }
```

- [ ] **Step 3: Replace the bottom bar markup**

Replace the entire `{/* Bottom bar */}` `<div className="flex items-center justify-between px-3 pb-2 pt-1">…</div>` block (lines ~90-133) with:

```tsx
          {/* Control bar */}
          <div className="flex items-center justify-between px-3 pb-2 pt-1">
            {/* Left: plus, mic, mode */}
            <div className="flex items-center gap-2">
              <PlusMenu onSlash={insertSlash} onPickFolder={onSetCwd} />
              {showMic && (
                <button
                  type="button"
                  onClick={dictation.toggle}
                  aria-label={dictation.listening ? 'Stop dictation' : 'Dictate with voice'}
                  title={dictation.listening ? 'Stop dictation' : 'Dictate with voice'}
                  aria-pressed={dictation.listening}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    dictation.listening
                      ? 'bg-destructive/20 text-destructive animate-pulse'
                      : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  <Mic size={15} />
                </button>
              )}
              <ModePicker value={permissionMode} onChange={onChangePermission} />
            </div>

            {/* Right: model, effort, usage, send */}
            <div className="flex items-center gap-2">
              <ModelPicker value={modelId} onChange={setModelId} />
              <EffortPicker value={settings.effort} onChange={(level) => update('effort', level)} />
              <UsagePill tokens={tokens} />
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                title={busy ? 'Working…' : 'Send message'}
                aria-label={busy ? 'Working, please wait' : 'Send message'}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  canSend
                    ? 'bg-accent hover:bg-accent-hover text-white cursor-pointer'
                    : 'bg-surface-2 text-fg-muted cursor-not-allowed'
                }`}
              >
                <ArrowUp size={14} />
              </button>
            </div>
          </div>
```

The `import { ... Slash } from 'lucide-react'` is no longer needed in Composer (Slash moved into PlusMenu) — the import edit in Step 1 already drops it. Keep the hint row `<p>` below unchanged.

- [ ] **Step 4: Thread props through `ChatView`**

In `ChatView.tsx`, extend the props and pass-through:

```tsx
import type { PermissionMode } from '@/cli/types'
// ...
export default function ChatView({
  session, onSend, composerRef, permissionMode, onChangePermission, onSetCwd,
}: {
  session: Session
  onSend: (text: string, modelId: string) => void
  composerRef?: React.Ref<ComposerHandle>
  permissionMode: PermissionMode
  onChangePermission: (mode: PermissionMode) => void
  onSetCwd: (path: string) => void
}): JSX.Element {
```

And the `<Composer .../>` call:

```tsx
      <Composer
        ref={composerRef}
        model={session.model}
        onSend={onSend}
        busy={session.status === 'running'}
        tokens={session.tokens}
        permissionMode={permissionMode}
        onChangePermission={onChangePermission}
        onSetCwd={onSetCwd}
      />
```

- [ ] **Step 5: Typecheck (App will now error — fixed in Task 13)**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `App.tsx` (ChatView now requires `permissionMode`/`onChangePermission`/`onSetCwd`). That is expected and fixed in the next task. Do not commit yet.

- [ ] **Step 6: Commit (after Task 13 makes tsc green)**

This task and Task 13 land together — proceed to Task 13 before committing.

---

## Task 13: Wire `App` (provide props, remove StatusBar select, add voice)

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/layout/StatusBar.tsx`

- [ ] **Step 1: Pass new props into `ChatView`**

In `App.tsx`, the `ChatView` render (line ~419) becomes:

```tsx
return (
  <ChatView
    session={activeSession}
    onSend={handleSend}
    composerRef={composerRef}
    permissionMode={permissionMode}
    onChangePermission={setPermissionMode}
    onSetCwd={(path) => sessionsDispatch({ type: 'setCwd', sessionId: activeSession.id, cwd: path })}
  />
)
```

- [ ] **Step 2: Add mode/effort/model voice commands**

Add these imports near the top of `App.tsx`:

```ts
import { MODE_OPTIONS } from '@/settings/permissionModes'
import { EFFORT_OPTIONS } from '@/settings/effort'
```

In the `commands` array, REMOVE the two existing one-off mode lines (`plan mode` and `accept edits`) and replace with generated mode + effort + model commands. Insert this block just before the closing `]` of `commands` (after the `quiet` command):

```ts
    // Permission modes (all four CLI modes, TH+EN).
    ...MODE_OPTIONS.map<VoiceCommand>((o) => ({
      phrases: o.phrases,
      run: () => setPermissionMode(o.mode),
      confirm: th ? `โหมด ${o.label}` : o.label,
      label: `“${o.label}”`,
    })),
    // Effort (cosmetic) — speaks confirmation, updates the persisted setting.
    ...EFFORT_OPTIONS.map<VoiceCommand>((o) => ({
      phrases: o.phrases,
      run: () => update('effort', o.level),
      confirm: th ? `เอฟฟอร์ต ${o.label}` : `Effort ${o.label}`,
      label: `“effort ${o.label}”`,
    })),
    // Model by spoken name → drives the Composer's local selection.
    { phrases: ['model opus', 'opus', 'โมเดลโอปุส', 'โอปุส'], run: () => composerRef.current?.setModel('opus-4-8'), confirm: th ? 'โมเดลโอปุส' : 'Opus', label: '“opus” / “โอปุส”' },
    { phrases: ['model sonnet', 'sonnet', 'โมเดลซอนเน็ต', 'ซอนเน็ต'], run: () => composerRef.current?.setModel('sonnet-4-6'), confirm: th ? 'โมเดลซอนเน็ต' : 'Sonnet', label: '“sonnet” / “ซอนเน็ต”' },
    { phrases: ['model haiku', 'haiku', 'โมเดลไฮกุ', 'ไฮกุ'], run: () => composerRef.current?.setModel('haiku-4-5'), confirm: th ? 'โมเดลไฮกุ' : 'Haiku', label: '“haiku” / “ไฮกุ”' },
```

> Longest-match in `dispatchCommand` keeps these from colliding with nav commands.

- [ ] **Step 3: Remove the mode `<select>` from `StatusBar`**

In `StatusBar.tsx`, delete the entire `{/* Permission mode */}` `<label>…</label>` block (lines ~57-70) and remove `onChangePermission` from the props/interface. Keep `permissionMode` as a read-only display chip instead — replace the deleted block with:

```tsx
        <span className="flex items-center gap-1.5" title="Permission mode (change it in the composer)">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-fg-muted">{PERMISSION_LABELS[permissionMode]}</span>
        </span>
```

Update the `StatusBarProps` interface: remove `onChangePermission: (mode: PermissionMode) => void`. In `App.tsx`, remove `onChangePermission={setPermissionMode}` from the `<StatusBar .../>` render (line ~512). Keep `permissionMode={permissionMode}` (still displayed).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors anywhere now.

- [ ] **Step 5: Full test suite**

Run: `npx vitest run`
Expected: all suites PASS (including the new mode/effort/Pill/setCwd tests; existing voiceCommands/streamMapper/useSessions/claude suites unchanged-green).

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: green (renderer + electron bundles).

- [ ] **Step 7: Commit (Tasks 12 + 13 together)**

```bash
git add src/renderer/views/chat/Composer.tsx src/renderer/views/chat/ChatView.tsx src/renderer/App.tsx src/renderer/layout/StatusBar.tsx
git commit -F - <<'EOF'
feat(composer): assemble Claude-app control bar + lift permission mode

- ComposerControlBar: PlusMenu, mic, ModePicker | ModelPicker, EffortPicker, UsagePill, send
- permissionMode lifted into the bar (App still reads it for the CLI); StatusBar select removed, now a read-only chip
- ComposerHandle.setModel for voice; mode/effort/model voice commands (TH+EN)
- Add folder retargets session cwd via app:pick-directory; Slash inserts "/"
EOF
```

---

## Task 14: Voice-command resolution tests (mode + effort)

**Files:**
- Modify: `src/renderer/settings/voiceCommands.test.ts`

- [ ] **Step 1: Add a describe block exercising mode/effort phrases through `dispatchCommand`**

Append to `voiceCommands.test.ts`:

```ts
import { MODE_OPTIONS } from './permissionModes'
import { EFFORT_OPTIONS } from './effort'

describe('mode + effort voice commands resolve through dispatchCommand', () => {
  it('each mode phrase set routes to its mode command, longest-match safe', () => {
    const setMode = vi.fn()
    const commands: VoiceCommand[] = MODE_OPTIONS.map((o) => ({
      phrases: o.phrases, run: () => setMode(o.mode), confirm: '', label: o.label,
    }))
    dispatchCommand(commands, 'please bypass permissions', 'en-US')
    expect(setMode).toHaveBeenCalledWith('bypassPermissions')
    dispatchCommand(commands, 'โหมดวางแผน', 'th-TH')
    expect(setMode).toHaveBeenCalledWith('plan')
  })

  it('effort phrases route to the right level', () => {
    const setEffort = vi.fn()
    const commands: VoiceCommand[] = EFFORT_OPTIONS.map((o) => ({
      phrases: o.phrases, run: () => setEffort(o.level), confirm: '', label: o.label,
    }))
    dispatchCommand(commands, 'make it smarter', 'en-US')
    expect(setEffort).toHaveBeenCalledWith('smarter')
    dispatchCommand(commands, 'เอฟฟอร์ตเร็ว', 'th-TH')
    expect(setEffort).toHaveBeenCalledWith('faster')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/renderer/settings/voiceCommands.test.ts`
Expected: PASS (original 4 + new 2).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/settings/voiceCommands.test.ts
git commit -F - <<'EOF'
test(composer): mode + effort voice phrases resolve through dispatchCommand
EOF
```

---

## Task 15: Final verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 2: Manual verify (Electron) — use the `run` skill or `npm run dev`**

Confirm, ideally via screenshots:
- The bar renders: `+` · mic · Mode | Model · Effort · ring · send.
- Mode pill: open, pick each of the 4 modes (keyboard 1–4 + arrows), checkmark + label update; StatusBar chip mirrors it.
- Effort pill: slider moves Faster↔Smarter, label updates, persists across reload (cosmetic note visible).
- Usage ring: opens, shows context % + plan rows.
- `+` menu: **Add folder** opens the native picker and changes the cwd (TitleBar/StatusBar reflect it); **Slash commands** focuses composer with `/`; files/Connectors/Plugins are disabled with "Coming soon".
- Voice (if testing live): "โหมดบายพาส", "เอฟฟอร์ตฉลาด", "โอปุส" each act + speak confirmation in the chosen voice.

> If Live shows "Not logged in", run `claude login` first (env note from the handoff).

- [ ] **Step 3: Push (ask first)**

Per project rules, pushing `main` requires explicit confirmation — ask the user before `git push origin main`.

---

## Self-Review

**Spec coverage:**
- Pill + Popover primitive → Task 4. ✅
- Five controls (Plus, Mode, Model, Effort, Usage) → Tasks 7–11 + assembly Task 12. ✅
- Lift `permissionMode` into the bar; StatusBar loses its mode dropdown → Task 13. ✅
- Model pill real (`toCliModel` guard re-run) → Task 11 Step 5. ✅
- Mode pill real (4 CLI modes) → Task 7. ✅
- Usage ring (session.tokens + USAGE fixture) → Task 9. ✅
- Plus menu: Add folder real (IPC + setCwd), Slash real, rest stub disabled → Tasks 5, 6, 10. ✅
- Effort cosmetic + persisted + labelled → Tasks 2, 3, 8. ✅
- Accessibility: pills are real buttons with `aria-haspopup`/`aria-expanded`/labels; roving `tabindex`; number shortcuts; Escape→trigger focus → Tasks 4, 7, 11. ✅
- Voice TH/EN for mode/effort/model via longest-match + speakSmart → Task 13; tests Task 14. ✅
- Testing: mode/effort mapping, roving helper, setCwd, voice resolution, model→CLI guard → Tasks 1, 2, 4, 6, 11, 14. ✅
- Out-of-scope (branch/PR header, Auto mode, effort→CLI, real attachments) correctly NOT built. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step has concrete code. ✅

**Type consistency:** `ComposerHandle.setModel(id)` defined in Task 12, called in Task 13. `setCwd` action shape identical in Tasks 6 & 13. `EffortLevel`/`PermissionMode` mappings reused, not re-declared. `Pill`/`Popover`/`usePopover`/`nextRovingIndex` signatures from Task 4 match every consumer (Tasks 7–11). ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-08-composer-control-bar.md`.
</content>
</invoke>
