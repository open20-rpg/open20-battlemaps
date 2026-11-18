import { describe, expect, it } from "vitest"
import { drawLayer, zFor } from "./drawOrder"

describe("drawLayer", () => {
  it("draws portals over walls but under the Above Walls layer", () => {
    const portal = zFor(drawLayer({ toolId: "portal", layer: 500 }), 0)
    expect(portal).toBeGreaterThan(zFor(drawLayer({ toolId: "wall", layer: 600 }), 99999))
    expect(portal).toBeLessThan(zFor(drawLayer({ toolId: "object", layer: 700 }), 0))
  })

  it("keeps every other entity on its own layer", () => {
    expect(drawLayer({ toolId: "object", layer: 100 })).toBe(100)
    expect(drawLayer({ toolId: "wall", layer: 600 })).toBe(600)
  })
})
