import { describe, expect, it } from "vitest"
import { groupByTime, relativeTime, timeGroup } from "./time"

const MIN = 60_000
const HOUR = 60 * MIN
// A Wednesday afternoon, local time.
const NOW = new Date(2026, 10, 18, 15, 0).getTime()

describe("timeGroup", () => {
  it("groups by how long ago, in local days", () => {
    expect(timeGroup(NOW - 5 * MIN, NOW)).toBe("lastHour")
    expect(timeGroup(NOW - 3 * HOUR, NOW)).toBe("today")
    expect(timeGroup(new Date(2026, 10, 17, 23, 0).getTime(), NOW)).toBe("yesterday")
    expect(timeGroup(new Date(2026, 10, 14, 12, 0).getTime(), NOW)).toBe("thisWeek")
    expect(timeGroup(new Date(2026, 9, 1).getTime(), NOW)).toBe("older")
  })
})

describe("groupByTime", () => {
  it("keeps the order and splits it into runs", () => {
    const items = [NOW - MIN, NOW - 2 * MIN, NOW - 4 * HOUR, NOW - 40 * 24 * HOUR].map(
      (createdAt) => ({ createdAt }),
    )
    const groups = groupByTime(items, NOW)
    expect(groups.map((g) => [g.group, g.items.length])).toEqual([
      ["lastHour", 2],
      ["today", 1],
      ["older", 1],
    ])
  })
})

describe("relativeTime", () => {
  it("says how long ago", () => {
    expect(relativeTime(NOW - 10_000, NOW, "en")).toBe("now")
    expect(relativeTime(NOW - 5 * MIN, NOW, "en")).toBe("5 minutes ago")
    expect(relativeTime(NOW - 3 * HOUR, NOW, "en")).toBe("3 hours ago")
    expect(relativeTime(new Date(2026, 10, 17, 10, 0).getTime(), NOW, "en")).toBe("yesterday")
    expect(relativeTime(new Date(2026, 10, 4).getTime(), NOW, "en")).toBe("2 weeks ago")
  })
})
