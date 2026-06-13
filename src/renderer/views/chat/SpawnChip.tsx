import { createContext, useContext, useState } from 'react'
import { GitBranchPlus, ArrowUpRight, X } from 'lucide-react'
import type { SpawnChipData } from '@/mock/fixtures'
import {
  type ChipStatus, canAct, getChipStatus, setChipStatus, resolveSpawnCwd,
} from './spawnChipLogic'

/**
 * Provides the spawn action + the current session's cwd to chips rendered deep in
 * the (memoized) message tree. Context bypasses React.memo, so AssistantMessage
 * stays memoized while chips still reach spawnTask. Default is a no-op so a chip
 * never crashes if rendered outside a provider.
 */
export interface SpawnContextValue {
  onSpawn: (prompt: string, cwd?: string) => void
  sessionCwd: string
}
export const SpawnContext = createContext<SpawnContextValue>({ onSpawn: () => {}, sessionCwd: '' })

export function SpawnChip({ chip }: { chip: SpawnChipData }): JSX.Element | null {
  const { onSpawn, sessionCwd } = useContext(SpawnContext)
  const [status, setStatus] = useState<ChipStatus>(() => getChipStatus(chip.toolUseId))

  const update = (s: ChipStatus): void => {
    setChipStatus(chip.toolUseId, s)
    setStatus(s)
  }
  const handleSpawn = (): void => {
    if (!canAct(status)) return
    onSpawn(chip.prompt, resolveSpawnCwd(chip.cwd, sessionCwd))
    update('spawned')
  }
  const handleDismiss = (): void => {
    if (!canAct(status)) return
    update('dismissed')
  }

  if (status === 'dismissed') return null

  const active = canAct(status)
  return (
    <div
      role="group"
      aria-label={`Suggested task: ${chip.title}`}
      className="my-2 rounded-lg border border-accent/30 bg-accent/10 p-3"
    >
      <div className="flex items-start gap-2">
        <GitBranchPlus size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">{chip.title}</div>
          {chip.tldr && <div className="mt-0.5 text-xs text-fg-muted">{chip.tldr}</div>}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {active ? (
          <>
            <button
              type="button"
              onClick={handleSpawn}
              aria-label={`Spawn a new session: ${chip.title}`}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <ArrowUpRight size={13} aria-hidden="true" />
              Spawn
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={`Dismiss suggested task: ${chip.title}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <X size={13} aria-hidden="true" />
              Dismiss
            </button>
          </>
        ) : (
          <span className="text-xs text-fg-muted" aria-live="polite">Opened in a new tab →</span>
        )}
      </div>
    </div>
  )
}
