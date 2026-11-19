import { describe, expect, it } from "vitest"
import { costsFrom, median } from "./perfProfile"

describe("render profile", () => {
  it("keeps the median frame time", () => {
    expect(median([5, 1, 30, 2, 3])).toBe(3)
    expect(median([4, 2])).toBe(3)
    expect(median([])).toBe(0)
  })

  it("costs each part what the frame saves without it, most expensive first", () => {
    const costs = costsFrom(10, [
      { id: "shadows", labelKey: "a", frameMs: 8 },
      { id: "grid", labelKey: "b", frameMs: 10.5 },
      { id: "water", labelKey: "c", tool: "water", frameMs: 4 },
    ])
    expect(costs.map((c) => [c.id, c.ms])).toEqual([
      ["water", 6],
      ["shadows", 2],
      // What no part accounts for.
      ["base", 2],
      // Measurement noise never makes a part look free-er than nothing.
      ["grid", 0],
    ])
    expect(costs[0].tool).toBe("water")
  })
})
