import { useState } from 'react'
import type { Session, FileChange, DiffLine } from '@/mock/fixtures'
import { deriveChanges } from '@/cli/deriveSessionState'

interface DiffViewProps {
  session: Session
}

export default function DiffView({ session }: DiffViewProps): JSX.Element {
  const files: FileChange[] = deriveChanges(session.messages)
  const [selectedFileId, setSelectedFileId] = useState<string>(
    files.length > 0 ? files[0].id : ''
  )

  const selectedFile = files.find((f) => f.id === selectedFileId)

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="text-4xl text-fg-muted opacity-40">∅</div>
          <p className="text-sm text-fg-muted">No changes</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 gap-0 overflow-hidden">
      {/* Left: file list */}
      <div className="w-64 shrink-0 border-r border-border overflow-y-auto">
        {files.map((file) => (
          <button
            key={file.id}
            onClick={() => setSelectedFileId(file.id)}
            className={`w-full px-3 py-2 text-left text-xs transition-colors border-l-2 ${
              selectedFileId === file.id
                ? 'border-l-accent bg-surface-2 text-fg'
                : 'border-l-transparent bg-bg hover:bg-surface text-fg'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded text-xs font-semibold ${
                  file.status === 'added'
                    ? 'bg-[rgba(34,197,94,0.2)] text-success'
                    : file.status === 'modified'
                      ? 'bg-[rgba(251,146,60,0.2)] text-accent'
                      : file.status === 'deleted'
                        ? 'bg-[rgba(239,68,68,0.2)] text-destructive'
                        : 'bg-[rgba(107,114,128,0.2)] text-fg-muted'
                }`}
              >
                {file.status === 'added'
                  ? 'A'
                  : file.status === 'modified'
                    ? 'M'
                    : file.status === 'deleted'
                      ? 'D'
                      : 'R'}
              </span>
              <span className="flex-1 truncate">
                <span className="font-medium">{file.path.split('/').pop()}</span>
                <span className="text-fg-muted"> {file.path.substring(0, file.path.lastIndexOf('/'))}</span>
              </span>
            </div>
            <div className="flex items-center gap-2 pl-7 text-xs">
              {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
              {file.deletions > 0 && <span className="text-destructive">-{file.deletions}</span>}
            </div>
          </button>
        ))}
      </div>

      {/* Right: diff viewer */}
      {selectedFile && (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border bg-surface px-3 py-2">
            <p className="text-xs font-medium text-fg">{selectedFile.path}</p>
          </div>
          <DiffContent file={selectedFile} />
        </div>
      )}
    </div>
  )
}

function DiffContent({ file }: { file: FileChange }): JSX.Element {
  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse">
        <tbody>
          {file.lines.map((line, idx) => (
            <DiffLineRow key={idx} line={line} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DiffLineRow({ line }: { line: DiffLine }): JSX.Element {
  if (line.kind === 'hunk') {
    return (
      <tr className="bg-muted">
        <td colSpan={3} className="px-3 py-1 font-mono text-xs text-fg-muted">
          {line.text}
        </td>
      </tr>
    )
  }

  const isAdd = line.kind === 'add'
  const isRemove = line.kind === 'remove'
  const isContext = line.kind === 'context'

  const bgClass =
    isAdd ? 'bg-[rgba(34,197,94,0.12)]' : isRemove ? 'bg-[rgba(239,68,68,0.12)]' : 'bg-bg'

  const textClass = isAdd || isRemove ? 'text-fg' : 'text-fg-muted'

  return (
    <tr className={`${bgClass} hover:bg-surface-2 transition-colors`}>
      <td className="w-12 shrink-0 select-none bg-muted px-2 py-0 text-right font-mono text-xs text-fg-muted">
        {isContext || isRemove ? line.oldNo : ''}
      </td>
      <td className="w-12 shrink-0 select-none bg-muted px-2 py-0 text-right font-mono text-xs text-fg-muted">
        {isContext || isAdd ? line.newNo : ''}
      </td>
      <td className={`px-3 py-0 font-mono text-xs ${textClass} whitespace-pre overflow-auto`}>
        <span className="inline-block w-4 select-none">
          {isAdd ? '+' : isRemove ? '−' : ' '}
        </span>
        {line.text}
      </td>
    </tr>
  )
}
