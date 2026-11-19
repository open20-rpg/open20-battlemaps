/** A byte count for people: B, KB, MB or GB (1024-based), one decimal from MB up. */
export function formatBytes(bytes: number, locale?: string): string {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = Math.max(0, bytes)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const digits = i >= 2 ? 1 : 0
  return `${v.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[i]}`
}
