import { describe, expect, it } from "vitest"
import { takeLiveDirty, touchLiveTerrain } from "./terrainLive"

describe("live terrain dirty area", () => {
  it("adds up the painted rectangles until the renderer takes them", () => {
    takeLiveDirty()
    touchLiveTerrain({ x0: 2, y0: 3, x1: 5, y1: 6 })
    touchLiveTerrain({ x0: 4, y0: 1, x1: 8, y1: 4 })
    expect(takeLiveDirty()).toEqual({ x0: 2, y0: 1, x1: 8, y1: 6 })
    expect(takeLiveDirty()).toBeNull()
  })

  it("asks for everything when a tick doesn't say what it painted", () => {
    touchLiveTerrain({ x0: 0, y0: 0, x1: 1, y1: 1 })
    touchLiveTerrain()
    expect(takeLiveDirty()).toBeNull()
  })
})
