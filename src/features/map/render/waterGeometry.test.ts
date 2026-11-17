import { describe, expect, it } from "vitest"
import { type MapEntity } from "../model/types"
import { ellipseSides, waterPolygons } from "./waterGeometry"

const water = (id: string, extra: Partial<MapEntity>): MapEntity => ({
  id,
  toolId: "water",
  layer: 0,
  position: { x: 0, y: 0 },
  rotation: 0,
  params: {},
  ...extra,
})
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

describe("water geometry (polygons with holes)", () => {
  it("unions shapes exactly and cuts Alt-drawn ones, in order", () => {
    const polys = waterPolygons([
      water("a", { points: rect(0, 0, 4, 4), closed: true }),
      water("b", { points: rect(2, 0, 6, 4), closed: true }),
      water("c", { points: rect(2, 1, 3, 2), closed: true, params: { erase: true } }),
    ])
    expect(polys).toHaveLength(1)
    // The union's outline is exact (no raster steps): 4 corners.
    expect(polys[0].outer).toHaveLength(4)
    expect(polys[0].holes).toHaveLength(1)
  })

  it("outlines brush strokes from the cell grid, jittered", () => {
    const [poly] = waterPolygons([
      water("s", {
        strokes: [
          {
            points: [
              { x: 2, y: 2 },
              { x: 4, y: 2 },
            ],
            radius: 0.5,
          },
        ],
      }),
    ])
    expect(poly.outer.length).toBeGreaterThan(8)
    const xs = poly.outer.map((p) => p.x)
    // A 4-cell stamp (1 tile across) along x 2–4: about x 1.5 to 4.5.
    expect(Math.min(...xs)).toBeGreaterThan(1.3)
    expect(Math.max(...xs)).toBeLessThan(4.7)
  })

  it("gives ellipses the reference number of sides", () => {
    // 1 × 1 tile: max(24, 8 cells) = 24 → under 32: 24/2 + 16 = 28 → round(6.72)·4.
    expect(ellipseSides(1, 1)).toBe(28)
    expect(ellipseSides(10, 10) % 4).toBe(0)
  })
})
