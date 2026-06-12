import { useState } from 'react'
import {
  FileText,
  FilePen,
  TerminalSquare,
  Search,
  Wrench,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from 'lucide-react'
import type { ToolCall } from '@/mock/fixtures'

interface ToolCallCardProps {
  call: ToolCall
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  Read: FileText,
  Edit: FilePen,
  Write: FilePen,
  Bash: TerminalSquare,
  Grep: Search,
}

function ToolIcon({ tool }: { tool: string }): JSX.Element {
  const Icon = TOOL_ICONS[tool] ?? Wrench
  return <Icon size={14} className="shrink-0 text-fg-muted" />
}

function StatusChip({ call }: { call: ToolCall }): JSX.Element {
  if (call.status === 'running') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-accent">
        <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
        Running
      </span>
    )
  }
  if (call.status === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <X size={12} />
        Error
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-success">
      <Check size={12} />
      Done
    </span>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function ToolCallCard({ call }: ToolCallCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const hasOutput = Boolean(call.output)

  return (
    <div className="my-1.5 rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => { if (hasOutput) setExpanded((e) => !e) }}
        className={`w-full flex items-center gap-2 px-3 py-2 bg-surface text-left transition-colors ${
          hasOutput ? 'hover:bg-surface-2 cursor-pointer' : 'cursor-default'
        } focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
        aria-expanded={expanded}
      >
        {/* Expand chevron */}
        <span className="shrink-0 text-fg-muted">
          {hasOutput ? (
            expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />
          ) : (
            <span className="inline-block w-[13px]" />
          )}
        </span>

        <ToolIcon tool={call.tool} />

        {/* Tool name */}
        <span className="text-xs font-medium text-fg">{call.tool}</span>

        {/* Label */}
        <span className="truncate font-mono text-xs text-fg-muted min-w-0 flex-1">{call.label}</span>

        {/* Right side: status + duration */}
        <span className="shrink-0 flex items-center gap-3">
          <StatusChip call={call} />
          {call.durationMs !== undefined && (
            <span className="text-xs text-fg-muted tabular-nums">
              {formatDuration(call.durationMs)}
            </span>
          )}
        </span>
      </button>

      {expanded && call.output && (
        <div className="border-t border-border bg-bg px-3 py-3 overflow-x-auto">
          <pre className="font-mono text-xs text-fg-muted leading-relaxed whitespace-pre-wrap">
            {call.output}
          </pre>
        </div>
      )}
    </div>
  )
}
