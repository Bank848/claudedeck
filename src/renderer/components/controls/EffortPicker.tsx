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
