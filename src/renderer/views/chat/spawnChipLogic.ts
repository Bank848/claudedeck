/**
 * Pure logic + in-memory state for spawn_task chips. Status is keyed by the
 * tool_use id (globally unique, so this doubles as per-session), lives only in
 * module memory, and resets on app restart (reload) — matching the Claude app,
 * where spawn_task ids are not persisted. Kept out of the .tsx so it's unit-tested
 * without a DOM (the repo has no RTL/jsdom).
 */
export type ChipStatus = 'pending' | 'spawned' | 'dismissed'

/** The folder the spawned session opens in: explicit chip cwd, else the session's. */
export function resolveSpawnCwd(chipCwd: string | undefined, sessionCwd: string): string {
  return chipCwd && chipCwd.trim() ? chipCwd : sessionCwd
}

/** Only pending chips have active Spawn/Dismiss buttons (guards double-spawn). */
export function canAct(status: ChipStatus): boolean {
  return status === 'pending'
}

const statusByToolUseId = new Map<string, ChipStatus>()

export function getChipStatus(toolUseId: string): ChipStatus {
  return statusByToolUseId.get(toolUseId) ?? 'pending'
}
export function setChipStatus(toolUseId: string, status: ChipStatus): void {
  statusByToolUseId.set(toolUseId, status)
}
/** Test-only: clear all statuses (also documents the app-restart reset semantics). */
export function resetChipStatuses(): void {
  statusByToolUseId.clear()
}
