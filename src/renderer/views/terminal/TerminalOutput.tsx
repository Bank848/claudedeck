import { useEffect, useRef } from 'react'
import { TERMINAL_LINES, type TerminalLine } from '@/mock/fixtures'

interface TerminalOutputProps {
  /** Live lines for the active session; falls back to the mock when omitted/empty. */
  lines?: TerminalLine[]
}

export default function TerminalOutput({ lines }: TerminalOutputProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const data = lines && lines.length > 0 ? lines : TERMINAL_LINES

  // Auto-scroll to bottom on mount and when content changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [data.length])

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-3 font-mono text-xs text-fg-muted">
        No output yet
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto bg-bg p-3 font-mono text-xs leading-relaxed">
      {data.map((line) => (
        <div key={line.id} className={getLineClass(line.kind)}>
          {line.kind === 'command' && <span className="mr-1 text-accent">$</span>}
          {line.text}
        </div>
      ))}
      <CaretBlinker />
    </div>
  )
}

function getLineClass(kind: string): string {
  switch (kind) {
    case 'command':
      return 'text-fg font-semibold'
    case 'stderr':
      return 'text-destructive'
    case 'system':
      return 'text-accent'
    case 'stdout':
    default:
      return 'text-fg'
  }
}

function CaretBlinker(): JSX.Element {
  // Check for prefers-reduced-motion
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (prefersReduced) {
    return (
      <span className="text-fg-muted">▌</span>
    )
  }

  return (
    <span className="inline-block text-fg-muted animate-pulse">▌</span>
  )
}
