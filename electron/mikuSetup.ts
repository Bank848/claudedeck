/**
 * Embedded-Python bootstrap for the Miku RVC voice server.
 *
 * The RVC server needs a real CPython with working `venv` + `pip`. Rather than
 * make the user install Python, we download a **python-build-standalone** CPython
 * (astral-sh) — a full portable interpreter (~25 MB compressed) that supports
 * venv/pip out of the box (unlike python.org's "embeddable zip"). It lands in a
 * WRITABLE dir under `userData/miku/python`, only when the user opts into Miku.
 *
 * The artifact is an `install_only` **`.tar.gz`** (Node has no built-in tar →
 * the `tar` npm dep extracts it). The venv + pip + torch + model steps are then
 * driven by `run.bat`, which reads `MIKU_HOME`/`MIKU_PYTHON`/`MIKU_TORCH`.
 *
 * Every step is **idempotent**: if the interpreter already exists we skip the
 * (large) download, so a retry after a failed run never re-fetches gigabytes.
 */
import { join } from 'node:path'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { x as extractTar } from 'tar'
import { downloadFile } from './download'

// Pinned python-build-standalone release (CPython 3.11, win x64, install_only).
// Bump the tag + version together when refreshing; the URL shape is stable.
const PY_TAG = '20240814'
const PY_VERSION = '3.11.9'
const PYTHON_URL =
  `https://github.com/astral-sh/python-build-standalone/releases/download/${PY_TAG}` +
  `/cpython-${PY_VERSION}+${PY_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`

export type SetupStep = 'python' | 'torch' | 'venv' | 'deps' | 'model' | 'done'
export interface SetupProgress {
  step: SetupStep
  percent: number
  message: string
}
export type Emit = (p: SetupProgress) => void

/** Path to the bootstrapped interpreter (whether or not it exists yet). */
export function embeddedPythonExe(mikuHome: string): string {
  return join(mikuHome, 'python', 'python.exe')
}

/** The torch wheel channel to install — CUDA when an NVIDIA GPU was detected. */
export function torchChannel(hasNvidia: boolean): 'cu124' | 'cpu' {
  return hasNvidia ? 'cu124' : 'cpu'
}

/** True if a usable system `py` launcher is present (lets us skip the download). */
export function hasSystemPy(): boolean {
  try {
    const r = spawnSync('py', ['-3', '-c', 'import sys'], { windowsHide: true, timeout: 8000 })
    return r.status === 0
  } catch {
    return false
  }
}

/**
 * Ensure a CPython usable for venv/pip exists. Returns the interpreter path to
 * hand to `run.bat` via `MIKU_PYTHON`, or `''` to let `run.bat` use the system
 * `py` launcher. Idempotent: an existing embedded interpreter is reused as-is.
 */
export async function ensurePython(mikuHome: string, emit: Emit): Promise<string> {
  const exe = embeddedPythonExe(mikuHome)
  if (existsSync(exe)) {
    emit({ step: 'python', percent: 100, message: 'พบ Python ที่ติดตั้งไว้แล้ว' })
    return exe
  }
  // A working system py launcher means run.bat can build the venv itself — skip
  // the ~25 MB download entirely.
  if (hasSystemPy()) {
    emit({ step: 'python', percent: 100, message: 'ใช้ Python ของระบบ (py launcher)' })
    return ''
  }

  if (!existsSync(mikuHome)) mkdirSync(mikuHome, { recursive: true })
  const archive = join(mikuHome, 'python.tar.gz')
  emit({ step: 'python', percent: 0, message: 'กำลังดาวน์โหลด Python…' })
  await downloadFile(PYTHON_URL, archive, (pct) =>
    emit({ step: 'python', percent: pct, message: `กำลังดาวน์โหลด Python… ${pct}%` }),
  )
  emit({ step: 'python', percent: 99, message: 'กำลังแตกไฟล์ Python…' })
  // install_only extracts to a top-level `python/` dir → mikuHome/python/python.exe.
  await extractTar({ file: archive, cwd: mikuHome })
  try {
    rmSync(archive, { force: true })
  } catch {
    /* leaving the archive is harmless; ignore cleanup failure */
  }
  if (!existsSync(exe)) throw new Error('python extract failed (python.exe missing)')
  emit({ step: 'python', percent: 100, message: 'ติดตั้ง Python เรียบร้อย' })
  return exe
}

/**
 * Prepare everything `run.bat` needs before the server is spawned: a CPython
 * interpreter + the chosen torch channel. The venv/pip/model/launch steps run
 * inside `run.bat` (its output streams to the existing Miku log + status), so
 * here we only report the parts we own.
 *
 * Returns `{ pythonExe, torch }` — the caller passes these to `run.bat` via env.
 */
export async function prepareMiku(
  mikuHome: string,
  hasNvidia: boolean,
  emit: Emit,
): Promise<{ pythonExe: string; torch: 'cu124' | 'cpu' }> {
  const pythonExe = await ensurePython(mikuHome, emit)
  const torch = torchChannel(hasNvidia)
  emit({
    step: 'torch',
    percent: 100,
    message: torch === 'cu124' ? 'เลือก PyTorch แบบ CUDA (GPU)' : 'เลือก PyTorch แบบ CPU',
  })
  return { pythonExe, torch }
}
