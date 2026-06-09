import { useRef, useState } from 'react'
import { ChevronDown, Sparkles, Plus, Check, Trash2 } from 'lucide-react'
import { useAssistants } from '@/settings/assistants'
import type { ModelOption, Provider } from '@/mock/fixtures'
import { usePopover, nextRovingIndex } from './Pill'

/** Provider icon + colour (Claude = coral spark). */
function ProviderIcon({ size = 13 }: { size?: number }): JSX.Element {
  return <Sparkles size={size} className="text-accent" />
}

interface ModelPickerProps {
  value: string
  onChange: (id: string) => void
}

export function ModelPicker({ value, onChange }: ModelPickerProps): JSX.Element {
  const { all, custom, add, remove } = useAssistants()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  // Only one provider for now; assistants are always added under 'claude'.
  const provider: Provider = 'claude'
  const [model, setModel] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selected = all.find((m) => m.id === value) ?? all[0]

  usePopover(open, () => {
    setOpen(false)
    setAdding(false)
  }, ref)

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

  const submitAdd = (): void => {
    if (!name.trim()) return
    const id = add(name, provider, model)
    onChange(id)
    setName('')
    setModel('')
    setAdding(false)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ProviderIcon />
        <span className="text-fg">{selected.label}</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full right-0 z-50 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        >
          <div className="max-h-72 overflow-y-auto py-1" onKeyDown={onListKeyDown}>
            {all.map((m, i) => (
              <ModelRow
                key={m.id}
                model={m}
                index={i}
                active={i === active}
                selected={m.id === selected.id}
                removable={custom.some((c) => c.id === m.id)}
                onFocus={() => setActive(i)}
                onSelect={() => {
                  onChange(m.id)
                  setOpen(false)
                }}
                onRemove={() => remove(m.id)}
              />
            ))}
          </div>

          {/* Add assistant */}
          <div className="border-t border-border p-2">
            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-surface-2"
              >
                <Plus size={14} />
                Add custom model
              </button>
            ) : (
              <div className="space-y-2 p-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
                  placeholder="Assistant name"
                  aria-label="Assistant name"
                  className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                />
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
                  placeholder="Model id (optional)"
                  aria-label="Model id"
                  className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={submitAdd}
                    className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ModelRow({
  model,
  selected,
  removable,
  index,
  active,
  onSelect,
  onRemove,
  onFocus,
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
    <div
      className={`group flex items-center gap-2 px-2 ${selected ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
    >
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
        <span className="w-4 shrink-0 text-center font-mono text-[11px] text-fg-muted">{index < 9 ? index + 1 : ''}</span>
        <ProviderIcon size={14} />
        <span className="min-w-0">
          <span className="block truncate text-sm text-fg">{model.label}</span>
          {model.sublabel && (
            <span className="block truncate text-xs text-fg-muted">{model.sublabel}</span>
          )}
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
