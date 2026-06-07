import { X, TerminalSquare } from 'lucide-react'
import TerminalOutput from '@/views/terminal/TerminalOutput'
import type { TerminalLine } from '@/mock/fixtures'

interface BottomPanelProps {
  onClose: () => void
  lines?: TerminalLine[]
}

export function BottomPanel({ onClose, lines }: BottomPanelProps): JSX.Element {
  return (
    <section className="flex h-full min-h-0 flex-col border-t border-border bg-bg">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-surface px-2">
        <div className="flex items-center">
          <span className="flex items-center gap-2 border-b-2 border-accent px-2 py-1 text-xs font-medium text-fg">
            <TerminalSquare size={14} />
            Terminal
          </span>
          <span className="px-3 py-1 text-xs text-fg-muted">Output</span>
        </div>
        <button
          type="button"
          title="Hide terminal"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <TerminalOutput lines={lines} />
      </div>
    </section>
  )
}
