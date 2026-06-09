import { useState } from 'react'
import { Plus, X } from 'lucide-react'

/**
 * Edit the per-turn tool allow / deny rule lists. A "rule" is a free-text
 * permission pattern (`Edit`, `Bash(git *)`, `mcp__renpy__*`) — not a fixed enum
 * — so each list is an add-input plus removable chips. Spaces inside a rule are
 * preserved (one rule = one argv token downstream).
 *
 * Accessible: each list is a labelled `role="list"`; chips are removable by
 * keyboard (the × is a real button); the add-input commits on Enter or the +.
 */
export interface ToolRulesEditorProps {
  allowed: string[]
  disallowed: string[]
  onChange: (next: { allowed: string[]; disallowed: string[] }) => void
}

export function ToolRulesEditor({ allowed, disallowed, onChange }: ToolRulesEditorProps): JSX.Element {
  return (
    <div className="space-y-4">
      <RuleList
        label="อนุญาตเครื่องมือ (Allow)"
        hint="ใช้เครื่องมือเหล่านี้ได้โดยไม่ต้องถาม — เช่น Edit, Bash(git *)"
        rules={allowed}
        onChange={(next) => onChange({ allowed: next, disallowed })}
      />
      <RuleList
        label="ปฏิเสธเครื่องมือ (Deny)"
        hint="ห้ามใช้เครื่องมือเหล่านี้ — เช่น WebFetch"
        rules={disallowed}
        onChange={(next) => onChange({ allowed, disallowed: next })}
      />
    </div>
  )
}

export function RuleList({
  label,
  hint,
  rules,
  onChange,
}: {
  label: string
  hint: string
  rules: string[]
  onChange: (next: string[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')

  const add = (): void => {
    const t = draft.trim()
    if (!t || rules.includes(t)) {
      setDraft('')
      return
    }
    onChange([...rules, t])
    setDraft('')
  }
  const remove = (rule: string): void => onChange(rules.filter((r) => r !== rule))

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-semibold text-fg">{label}</span>
        <span className="text-[10px] text-fg-muted">{hint}</span>
      </div>

      {rules.length > 0 && (
        <ul role="list" aria-label={label} className="mb-2 flex flex-wrap gap-1.5">
          {rules.map((r) => (
            <li key={r}>
              <span className="flex items-center gap-1 rounded-full border border-border bg-bg py-0.5 pl-2.5 pr-1 text-xs text-fg">
                <span className="font-mono">{r}</span>
                <button
                  type="button"
                  onClick={() => remove(r)}
                  aria-label={`ลบกฎ ${r}`}
                  className="rounded-full p-0.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <X size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1.5">
        <input
          aria-label={`เพิ่มกฎ — ${label}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="เช่น Bash(git *)"
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          aria-label={`เพิ่มกฎลงใน ${label}`}
          className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={13} />
          เพิ่ม
        </button>
      </div>
    </div>
  )
}
