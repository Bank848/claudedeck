import { useEffect, useState } from 'react'
import {
  Minus,
  Square,
  Copy,
  X,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Sparkles,
} from 'lucide-react'

interface TitleBarProps {
  title: string
  project: string
  sidebarOpen: boolean
  rightOpen: boolean
  bottomOpen: boolean
  onToggleSidebar: () => void
  onToggleRight: () => void
  onToggleBottom: () => void
}

export function TitleBar({
  title,
  project,
  sidebarOpen,
  rightOpen,
  bottomOpen,
  onToggleSidebar,
  onToggleRight,
  onToggleBottom,
}: TitleBarProps): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const api = window.claudedeck
    if (!api) return
    api.isMaximized().then(setMaximized)
    return api.onMaximizedChanged(setMaximized)
  }, [])

  return (
    <header
      className="drag-region flex items-center justify-between border-b border-border bg-surface px-2 text-fg"
      style={{ height: 'var(--titlebar-h)' }}
    >
      {/* Left: brand + panel toggles */}
      <div className="no-drag flex items-center gap-1">
        <span className="flex items-center gap-1.5 px-1.5 text-sm font-semibold">
          <Sparkles size={15} className="text-accent" />
          {title}
        </span>
        <div className="ml-1 flex items-center">
          <PanelToggle active={sidebarOpen} onClick={onToggleSidebar} title="Toggle sidebar">
            <PanelLeft size={15} />
          </PanelToggle>
          <PanelToggle active={bottomOpen} onClick={onToggleBottom} title="Toggle terminal">
            <PanelBottom size={15} />
          </PanelToggle>
          <PanelToggle active={rightOpen} onClick={onToggleRight} title="Toggle tasks panel">
            <PanelRight size={15} />
          </PanelToggle>
        </div>
      </div>

      {/* Center: project path */}
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-xs text-fg-muted">
        {project}
      </div>

      {/* Right: window controls */}
      <div className="no-drag flex items-center">
        <WindowButton onClick={() => window.claudedeck?.minimize()} title="Minimize">
          <Minus size={15} />
        </WindowButton>
        <WindowButton
          onClick={() => window.claudedeck?.toggleMaximize()}
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy size={13} /> : <Square size={12} />}
        </WindowButton>
        <WindowButton danger onClick={() => window.claudedeck?.close()} title="Close">
          <X size={16} />
        </WindowButton>
      </div>
    </header>
  )
}

function PanelToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-surface-2 ${
        active ? 'text-fg' : 'text-fg-muted'
      }`}
    >
      {children}
    </button>
  )
}

function WindowButton({
  onClick,
  title,
  danger,
  children,
}: {
  onClick: () => void
  title: string
  danger?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-8 w-11 items-center justify-center text-fg-muted transition-colors hover:text-fg ${
        danger ? 'hover:bg-destructive hover:text-white' : 'hover:bg-surface-2'
      }`}
    >
      {children}
    </button>
  )
}
