import { X, Plus, Circle, GitBranch } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Session } from '@/mock/fixtures'
import { indicatorKind, indicatorLabel, type IndicatorKind } from '@/state/sessionIndicator'

interface TabStripProps {
  sessions: Session[]
  activeSessionId: string
  onSelect: (id: string) => void
  onNew: () => void
  onClose: (id: string) => void
  onCloseOthers?: (id: string) => void
  onCloseAll?: () => void
  onCloseToRight?: (id: string) => void
  onReorder?: (fromId: string, toId: string) => void
  /** Fork this tab's conversation into a new tab (copies the chat, same cwd). */
  onFork?: (id: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  sessionId: string
}

const DOT_COLOR: Record<IndicatorKind, string> = {
  needsInput: 'text-warning',
  error: 'text-destructive',
  unread: 'text-success',
  running: 'text-success',
  active: 'text-accent',
  idle: 'text-fg-muted',
}

export function TabStrip({ sessions, activeSessionId, onSelect, onNew, onClose, onCloseOthers, onCloseAll, onCloseToRight, onReorder, onFork }: TabStripProps): JSX.Element {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId: id })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent, id: string) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (id !== dragId) setDragOverId(id)
    },
    [dragId],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent, toId: string) => {
      e.preventDefault()
      if (dragId && dragId !== toId) onReorder?.(dragId, toId)
      setDragId(null)
      setDragOverId(null)
    },
    [dragId, onReorder],
  )

  const handleDragEnd = useCallback(() => {
    setDragId(null)
    setDragOverId(null)
  }, [])

  const contextMenuSession = contextMenu ? sessions.find((s) => s.id === contextMenu.sessionId) : null
  const contextMenuIdx = contextMenu ? sessions.findIndex((s) => s.id === contextMenu.sessionId) : -1
  const hasTabsToRight = contextMenuIdx !== -1 && contextMenuIdx < sessions.length - 1

  return (
    <>
      <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-surface">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-thin">
          {sessions.map((s) => {
            const active = s.id === activeSessionId
            const isDragging = s.id === dragId
            const isDragOver = s.id === dragOverId
            return (
              <div
                key={s.id}
                draggable={!!onReorder}
                onDragStart={(e) => handleDragStart(e, s.id)}
                onDragOver={(e) => handleDragOver(e, s.id)}
                onDrop={(e) => handleDrop(e, s.id)}
                onDragEnd={handleDragEnd}
                onContextMenu={(e) => handleContextMenu(e, s.id)}
                className={`group relative flex max-w-[200px] items-stretch border-r border-border text-sm transition-colors ${
                  active ? 'bg-bg text-fg' : 'bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg'
                } ${isDragging ? 'opacity-40' : ''} ${isDragOver ? 'border-l-2 border-l-accent' : ''}`}
              >
                {active && <span className="absolute left-0 top-0 h-0.5 w-full bg-accent" />}
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-current={active ? 'page' : undefined}
                  className="flex min-w-0 items-center gap-2 py-0 pl-3 pr-1 cursor-grab active:cursor-grabbing"
                >
                  <Circle size={8} className={`shrink-0 fill-current ${DOT_COLOR[indicatorKind(s)]}`} aria-hidden="true" />
                  <span className="sr-only">{indicatorLabel(s)}: </span>
                  <span className="truncate">{s.title}</span>
                </button>
                {onFork && (
                  <button
                    type="button"
                    aria-label={`Fork ${s.title} into a new tab`}
                    title="Fork conversation into a new tab"
                    onClick={(e) => {
                      e.stopPropagation()
                      onFork(s.id)
                    }}
                    className="flex shrink-0 items-center rounded px-0.5 opacity-0 transition-opacity hover:text-fg group-hover:opacity-60 focus-visible:opacity-100"
                  >
                    <GitBranch size={12} className="rounded hover:bg-surface-2" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Close ${s.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(s.id)
                  }}
                  className="flex shrink-0 items-center rounded pr-2 pl-0.5 opacity-0 transition-opacity hover:text-fg group-hover:opacity-60 focus-visible:opacity-100"
                >
                  <X size={13} className="rounded hover:bg-surface-2" />
                </button>
              </div>
            )
          })}
          {sessions.length === 0 && (
            <div className="flex items-center px-3 text-xs text-fg-muted" role="status">
              No open tabs — pick a session from the sidebar, or press + for a new one.
            </div>
          )}
        </div>
        <button
          type="button"
          title="New session"
          aria-label="New session"
          onClick={onNew}
          className="flex w-9 items-center justify-center text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <Plus size={16} />
        </button>
      </div>

      {contextMenu && contextMenuSession && (
        <>
          {/* backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeContextMenu()
            }}
          />
          {/* menu */}
          <div
            className="fixed z-50 min-w-[180px] rounded-md border border-border bg-surface py-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
          >
            <button
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-fg hover:bg-surface-2"
              onClick={() => {
                onClose(contextMenu.sessionId)
                closeContextMenu()
              }}
            >
              <X size={13} />
              Close tab
            </button>
            {onCloseOthers && sessions.length > 1 && (
              <button
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-fg hover:bg-surface-2"
                onClick={() => {
                  onCloseOthers(contextMenu.sessionId)
                  closeContextMenu()
                }}
              >
                Close other tabs
              </button>
            )}
            {onCloseToRight && hasTabsToRight && (
              <button
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-fg hover:bg-surface-2"
                onClick={() => {
                  onCloseToRight(contextMenu.sessionId)
                  closeContextMenu()
                }}
              >
                Close tabs to the right
              </button>
            )}
            {onFork && (
              <>
                <div className="my-1 border-t border-border" role="separator" />
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-fg hover:bg-surface-2"
                  onClick={() => {
                    onFork(contextMenu.sessionId)
                    closeContextMenu()
                  }}
                >
                  <GitBranch size={13} />
                  Fork tab
                </button>
              </>
            )}
            {onCloseAll && (
              <>
                <div className="my-1 border-t border-border" role="separator" />
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-2"
                  onClick={() => {
                    onCloseAll()
                    closeContextMenu()
                  }}
                >
                  Close all tabs
                </button>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
