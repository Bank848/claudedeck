/**
 * Semver-precedence version compare — a PURE module for the REST update path.
 *
 * The `app:check-update` handler polls GitHub's REST API for the latest release
 * tag and asks "is that newer than what's installed?". That answer flows through
 * `isNewer()`. The old inline compare split on `.` and `parseInt`'d each part, so
 * `"0.2.0-beta.1"` parsed to `[0,2,0,1]` (the `-beta` swallowed by
 * `parseInt("0-beta")=0`) and `isNewer("0.2.0","0.2.0-beta.1")` came out FALSE —
 * meaning users on a beta would never be told a stable release exists.
 *
 * electron-updater's own download path uses real semver and is unaffected; this
 * module fixes ONLY the REST path, hand-writing semver §11 precedence so we add
 * no npm dependency. Inputs come from GitHub tag names (with the `v` stripped)
 * and `app.getVersion()`, so junk is tolerated — non-numeric core parts become 0
 * and nothing throws.
 */

/** Split "1.2.3-beta.1" into its numeric core parts and its pre-release identifiers. */
function parseVersion(v: string): { core: number[]; pre: string[] } {
  const dash = v.indexOf('-')
  const coreStr = dash === -1 ? v : v.slice(0, dash)
  const preStr = dash === -1 ? '' : v.slice(dash + 1)
  // Non-numeric core parts (junk) → 0, per the "tolerate junk" contract.
  const core = coreStr.split('.').map((n) => {
    const parsed = parseInt(n, 10)
    return Number.isNaN(parsed) ? 0 : parsed
  })
  const pre = preStr === '' ? [] : preStr.split('.')
  return { core, pre }
}

/** Compare two numeric cores (shorter padded with 0s). Returns -1 / 0 / 1. */
function compareCore(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/**
 * Compare two pre-release identifier lists per semver §11. Returns -1 / 0 / 1.
 * Assumes BOTH lists are non-empty (the "no-suffix beats suffix" case is handled
 * by the caller). Numeric identifiers compare numerically and have LOWER
 * precedence than alphanumeric; alphanumeric compare lexically (ASCII); when all
 * shared identifiers are equal the shorter list has lower precedence.
 */
function comparePre(a: string[], b: string[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i]
    const bi = b[i]
    // Shorter list ran out first → lower precedence.
    if (ai === undefined) return -1
    if (bi === undefined) return 1
    const aNum = /^\d+$/.test(ai)
    const bNum = /^\d+$/.test(bi)
    if (aNum && bNum) {
      const d = parseInt(ai, 10) - parseInt(bi, 10)
      if (d !== 0) return d > 0 ? 1 : -1
    } else if (aNum !== bNum) {
      // Numeric has lower precedence than alphanumeric.
      return aNum ? -1 : 1
    } else {
      // Both alphanumeric → lexical ASCII compare.
      if (ai < bi) return -1
      if (ai > bi) return 1
    }
  }
  return 0
}

/** True if version `a` is strictly newer than `b` (semver precedence, §11). */
export function isNewer(a: string, b: string): boolean {
  const va = parseVersion(a)
  const vb = parseVersion(b)

  const coreCmp = compareCore(va.core, vb.core)
  if (coreCmp !== 0) return coreCmp > 0

  // Equal cores: a version with NO pre-release outranks one WITH a pre-release.
  const aHasPre = va.pre.length > 0
  const bHasPre = vb.pre.length > 0
  if (aHasPre !== bHasPre) return !aHasPre // a newer iff a has no suffix
  if (!aHasPre && !bHasPre) return false // identical stable cores

  return comparePre(va.pre, vb.pre) > 0
}
