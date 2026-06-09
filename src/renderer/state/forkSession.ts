/**
 * Pure helpers for the "fork to new worktree" feature. No React, no IPC — unit-testable.
 * Branch names produced here MUST satisfy the main-process `isValidRef` guard in
 * electron/git.ts (regex /^[^\s-][^\s~^:?*[\\]*$/ and no '..'); `isValidBranchName` below
 * mirrors that rule for the dialog's client-side guard.
 */

/** lowercase, non-alphanumerics → dashes, collapse + trim dashes, cap length. */
export function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '')
}

/** YYYYMMDD-HHMMSS in local time, zero-padded. */
function stamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  )
}

/**
 * Default branch for a fork: `fork/<slug of first ~6 words of seed>`, or
 * `fork/<timestamp>` when there is no usable seed. Always a valid ref.
 */
export function defaultForkBranch(seed: string, now: Date): string {
  const slug = slugify(seed.split(/\s+/).slice(0, 6).join(' '))
  return slug ? `fork/${slug}` : `fork/${stamp(now)}`
}

/** Mirror of electron/git.ts isValidRef — for the dialog's Fork-button enable guard. */
export function isValidBranchName(name: string): boolean {
  return /^[^\s-][^\s~^:?*[\\]*$/.test(name) && !name.includes('..')
}
