import { describe, expect, it } from "vitest"
import { nearestSnap } from "./snap"

describe("nearestSnap", () => {
  it("prefers the closest provider point within reach, else the grid's", () => {
    const grid = { x: 1, y: 1 }
    expect(
      nearestSnap({ x: 0, y: 0 }, grid, [
        { x: 0.3, y: 0 },
        { x: 0.1, y: 0 },
      ]),
    ).toEqual({ x: 0.1, y: 0 })
    expect(nearestSnap({ x: 0, y: 0 }, grid, [{ x: 2, y: 0 }])).toEqual(grid)
    expect(nearestSnap({ x: 0, y: 0 }, null, [])).toBeNull()
  })
})
