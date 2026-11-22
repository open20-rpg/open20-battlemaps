/**
 * The small part of semver extensions need: versions `MAJOR.MINOR.PATCH`
 * and ranges `^x.y.z`, `~x.y.z`, `>=x.y.z`, `x.y.z` or `*`. Pre-release and
 * build tags are not supported: extension versions are plain releases.
 */
export type Version = [number, number, number]

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseVersion(text: string): Version | null {
  const m = VERSION_RE.exec(text.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

export function isRange(range: string): boolean {
  const r = range.trim()
  if (r === "*") return true
  const op = /^(\^|~|>=)?(.*)$/.exec(r)
  return !!op && parseVersion(op[2]) !== null
}

/** Whether `version` satisfies `range` (false when either is malformed). */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version)
  if (!v) return false
  const r = range.trim()
  if (r === "*") return true
  const m = /^(\^|~|>=)?(.*)$/.exec(r)
  const base = m && parseVersion(m[2])
  if (!m || !base) return false
  const cmp = compareVersions(v, base)
  if (cmp < 0) return false
  switch (m[1]) {
    case undefined:
      return cmp === 0
    case ">=":
      return true
    case "~":
      return v[0] === base[0] && v[1] === base[1]
    case "^":
      // ^0.y.z only allows patches of 0.y (as npm does).
      return base[0] === 0 ? v[0] === 0 && v[1] === base[1] : v[0] === base[0]
  }
  return false
}
