/** Small accessible form controls shared by Settings (and future surfaces). */

interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  id?: string
}

export function Toggle({ checked, onChange, label, id }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-surface-2'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  ariaLabel: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: SegmentedProps<T>): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-border bg-bg p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              active ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
}

export function Select({ value, onChange, options, ariaLabel }: SelectProps): JSX.Element {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-[180px] rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg transition-colors hover:border-border-strong focus:border-accent focus:outline-none"
    >
      {options.map((opt, i) => (
        // Index-suffixed key: option values can collide (e.g. a mic with a blank
        // deviceId vs the "System default" entry) and React warns on dup keys.
        <option key={`${opt.value}-${i}`} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

interface SliderProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  ariaLabel: string
}

export function Slider({ value, min, max, step, onChange, ariaLabel }: SliderProps): JSX.Element {
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-44 cursor-pointer appearance-none rounded-full bg-surface-2 accent-accent"
    />
  )
}
