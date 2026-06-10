/**
 * Miku setup preflight — a PURE spec-check.
 *
 * `decide()` takes an already-gathered `Probe` (disk/ram/gpu/net/arch) and
 * returns a verdict. It does NO real I/O — the actual probing (wmic, os.totalmem,
 * a HEAD request) lives in `main.ts`'s `gatherProbe()`, which injects the result
 * here. Keeping the decision pure makes the pass/warn/fail rules unit-testable
 * without touching real hardware (repo TDD convention).
 *
 * Levels: `fail` blocks Miku setup (stay on edge-tts); `warn` proceeds but tells
 * the user why it'll be slower/risky; `pass` is clean. Overall `ok = no fail`.
 */

export type CheckId = 'disk' | 'ram' | 'gpu' | 'net' | 'arch'
export type Level = 'pass' | 'warn' | 'fail'

export interface Check {
  id: CheckId
  level: Level
  detail: string
}

export interface Probe {
  /** Free space (GB) on the drive that holds userData (where python/venv/models land). */
  freeDiskGB: number
  /** Total physical RAM (GB). */
  totalRamGB: number
  /** An NVIDIA GPU was detected → CUDA torch is viable. */
  hasNvidia: boolean
  /** A reachability probe to pypi/github succeeded. */
  online: boolean
  /** `process.arch` — only `x64` has the bundled standalone-CPython + wheels. */
  arch: string
}

export interface Verdict {
  ok: boolean
  level: Level
  checks: Check[]
}

// Thresholds (GB). Embedded CPython + torch (cpu ~200MB / cu124 ~2.5GB) + RVC
// model + working space comfortably fit under 3GB free; below that, fail.
const DISK_FAIL_GB = 3
const RAM_FAIL_GB = 4
const RAM_WARN_GB = 8

/** The worst level wins for the overall verdict (fail > warn > pass). */
function worst(checks: Check[]): Level {
  if (checks.some((c) => c.level === 'fail')) return 'fail'
  if (checks.some((c) => c.level === 'warn')) return 'warn'
  return 'pass'
}

export function decide(probe: Probe): Verdict {
  const checks: Check[] = [
    probe.freeDiskGB < DISK_FAIL_GB
      ? { id: 'disk', level: 'fail', detail: `พื้นที่ว่าง ${probe.freeDiskGB.toFixed(1)}GB — ต้องอย่างน้อย ${DISK_FAIL_GB}GB` }
      : { id: 'disk', level: 'pass', detail: `พื้นที่ว่าง ${probe.freeDiskGB.toFixed(1)}GB` },

    probe.totalRamGB < RAM_FAIL_GB
      ? { id: 'ram', level: 'fail', detail: `แรม ${probe.totalRamGB.toFixed(1)}GB — น้อยเกินไป (ต้อง ≥ ${RAM_FAIL_GB}GB)` }
      : probe.totalRamGB < RAM_WARN_GB
        ? { id: 'ram', level: 'warn', detail: `แรม ${probe.totalRamGB.toFixed(1)}GB — พอใช้ได้แต่อาจช้า` }
        : { id: 'ram', level: 'pass', detail: `แรม ${probe.totalRamGB.toFixed(1)}GB` },

    probe.hasNvidia
      ? { id: 'gpu', level: 'pass', detail: 'พบ NVIDIA GPU — ใช้ CUDA (เร็ว)' }
      : { id: 'gpu', level: 'warn', detail: 'ไม่พบ NVIDIA GPU — ใช้โหมด CPU (ช้ากว่า)' },

    probe.online
      ? { id: 'net', level: 'pass', detail: 'ออนไลน์' }
      : { id: 'net', level: 'fail', detail: 'ออฟไลน์ — ต้องต่อเน็ตเพื่อดาวน์โหลด Python/torch/โมเดล' },

    probe.arch === 'x64'
      ? { id: 'arch', level: 'pass', detail: 'สถาปัตยกรรม x64' }
      : { id: 'arch', level: 'fail', detail: `สถาปัตยกรรม ${probe.arch} — รองรับเฉพาะ x64` },
  ]

  const level = worst(checks)
  return { ok: level !== 'fail', level, checks }
}
