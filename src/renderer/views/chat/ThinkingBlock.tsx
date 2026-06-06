import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'

interface ThinkingBlockProps {
  text: string
}

export function ThinkingBlock({ text }: ThinkingBlockProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-2 border-l-2 border-border-strong pl-3">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 text-xs text-fg-muted transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded cursor-pointer"
        aria-expanded={expanded}
      >
        <Brain size={13} className="shrink-0" />
        <span className="italic">Thinking</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {expanded && (
        <p className="mt-2 text-xs text-fg-muted italic leading-relaxed whitespace-pre-wrap">
          {text}
        </p>
      )}
    </div>
  )
}
