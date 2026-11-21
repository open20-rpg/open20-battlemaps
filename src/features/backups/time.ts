const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How the backups list groups a map's backups, nearest first. */
export type TimeGroup = "lastHour" | "today" | "yesterday" | "thisWeek" | "older"

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The group a backup taken at `at` falls in, seen at `now` (local days). */
export function timeGroup(at: number, now: number): TimeGroup {
  if (now - at < HOUR) return "lastHour"
  const today = startOfDay(now)
  if (at >= today) return "today"
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (at >= yesterday.getTime()) return "yesterday"
  if (now - at < 7 * DAY) return "thisWeek"
  return "older"
}

/** `items` (newest first) split into consecutive runs of the same group. */
export function groupByTime<T extends { createdAt: number }>(
  items: readonly T[],
  now: number,
): { group: TimeGroup; items: T[] }[] {
  const out: { group: TimeGroup; items: T[] }[] = []
  for (const item of items) {
    const group = timeGroup(item.createdAt, now)
    const last = out.at(-1)
    if (last?.group === group) last.items.push(item)
    else out.push({ group, items: [item] })
  }
  return out
}

/** "5 minutes ago", "yesterday"… in `locale`. */
export function relativeTime(at: number, now: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const diff = now - at
  if (diff < MINUTE) return rtf.format(0, "second")
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), "minute")
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), "hour")
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY)
  if (days < 7) return rtf.format(-Math.max(1, days), "day")
  if (days < 30) return rtf.format(-Math.floor(days / 7), "week")
  return rtf.format(-Math.floor(days / 30), "month")
}
