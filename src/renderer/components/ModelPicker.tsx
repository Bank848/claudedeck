import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Sparkles, Bot, Plus, Check, Trash2 } from 'lucide-react'
import { useAssistants } from '@/settings/assistants'
import type { ModelOption, Provider } from '@/mock/fixtures'
import { Segmented } from './controls'

/** Provider icon + colour (Claude = coral spark, Codex = emerald bot). */
function ProviderIcon({ provider, size = 13 }: { provider: Provider; size?: number }): JSX.Element {
  return provider === 'claude' ? (
    <Sparkles size={size} className="text-accent" />
  ) : (
    <Bot size={size} className="text-emerald-400" />
  )
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
  const [provider, setProvider] = useState<Provider>('claude')
  const [model, setModel] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selected = all.find((m) => m.id === value) ?? all[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setAdding(false)
      }
    }
    window.addEventListener('mousedown', onDoc)
    return () => window.removeEventListener('mousedown', onDoc)
  }, [open])

  const submitAdd = (): void => {
    if (!name.trim()) return
    const id = add(name, provider, model)
    onChange(id)
    setName('')
    setModel('')
    setProvider('claude')
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
        <ProviderIcon provider={selected.provider} />
        <span className="text-fg">{selected.label}</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {all.map((m) => (
              <ModelRow
                key={m.id}
                model={m}
                selected={m.id === selected.id}
                removable={custom.some((c) => c.id === m.id)}
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
                <div className="flex items-center justify-between gap-2">
                  <Segmented
                    ariaLabel="Provider"
                    value={provider}
                    onChange={setProvider}
                    options={[
                      { value: 'claude' as Provider, label: 'Claude' },
                      { value: 'codex' as Provider, label: 'Codex' },
                    ]}
                  />
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
  onSelect,
  onRemove,
}: {
  model: ModelOption
  selected: boolean
  removable: boolean
  onSelect: () => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div
      className={`group flex items-center gap-2 px-2 ${selected ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
    >
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
      >
        <ProviderIcon provider={model.provider} size={14} />
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
