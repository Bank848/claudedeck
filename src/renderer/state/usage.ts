export interface UsageWindow { utilization: number; resetsAt: string }
export interface RealUsage {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  sevenDayOpus: UsageWindow | null
  sevenDaySonnet: UsageWindow | null
  extraUsageEnabled: boolean
  subscriptionType?: string
  rateLimitTier?: string
}
export type UsageResult = { ok: true; usage: RealUsage } | { ok: false; error: string }

/** Format a future ISO timestamp as "Xd Yh" (days) or "Xh Ym" (hours). Returns "now" when past. */
export function formatResetsIn(resetsAt: string, now: Date): string {
  const diff = new Date(resetsAt).getTime() - now.getTime()
  if (diff <= 0) return 'now'
  const totalMins = Math.floor(diff / 60_000)
  const totalHours = Math.floor(totalMins / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const mins = totalMins % 60
  if (days > 0) return `${days}d ${hours}h`
  return `${totalHours}h ${mins}m`
}
