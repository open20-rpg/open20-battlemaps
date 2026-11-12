import { describe, expect, it } from "vitest"
import {
  brushCursorRadius,
  brushRadius,
  cellsToMap,
  emptyGrid,
  MATERIAL_CELLS_PER_TILE,
  materialBrushRadius,
  materialCursorRadius,
  stamp,
  stampOf,
  stampStroke,
  type CellGrid,
} from "./cells"

const count = (g: CellGrid) => g.cells.reduce((s, v) => s + v, 0)

describe("cell grid stamps (Dungeondraft's cave/water brushes)", () => {
  it("maps the five brush sizes to stamps and cursor radii", () => {
    expect([0, 1, 2, 3, 4].map((i) => stampOf(brushRadius(i)))).toEqual([3, 4, 5, 6, 11])
    expect(brushRadius(1)).toBe(0.5) // 4 cells = 1 tile across
    expect(brushCursorRadius(1)).toBe(0.5)
    expect(brushCursorRadius(4)).toBe(1.25)
  })

  it("stamps pixel circles: a 3-cell cross, a 4-cell disc without corners", () => {
    const g = emptyGrid(4, 4)
    stamp(g, { x: 2.1, y: 2.1 }, 3, 1)
    expect(count(g)).toBe(5)
    const h = emptyGrid(4, 4)
    stamp(h, { x: 2, y: 2 }, 4, 1)
    expect(count(h)).toBe(12)
    const one = emptyGrid(1, 1)
    stamp(one, { x: 0.25, y: 0.5 }, 1, 1)
    expect([...one.cells].indexOf(1)).toBe(2 * 4 + 1)
  })

  it("stamps along a stroke without gaps, and erases with 0", () => {
    const g = emptyGrid(10, 2)
    stampStroke(
      g,
      {
        points: [
          { x: 0.1, y: 1.1 },
          { x: 9.9, y: 1.1 },
        ],
        radius: 1 / 8,
      },
      1,
    )
    // One row of single cells all along: 40 cells.
    expect(count(g)).toBe(40)
    stampStroke(g, { points: [{ x: 5.1, y: 1.1 }], radius: 1 / 8 }, 0)
    expect(count(g)).toBe(39)
  })
})

describe("material grid (Dungeondraft's MaterialMesh: 128 px cells)", () => {
  it("maps the five brush sizes to stamps and cursor radii", () => {
    const m = MATERIAL_CELLS_PER_TILE
    expect([0, 1, 2, 3, 4].map((i) => stampOf(materialBrushRadius(i), m))).toEqual([3, 4, 5, 6, 7])
    expect(materialBrushRadius(1)).toBe(1) // 4 cells of half a tile = 2 tiles across
    expect(materialCursorRadius(0)).toBe(0.5)
    expect(materialCursorRadius(4)).toBe(2.5)
  })

  it("stamps and maps back at half-tile cells", () => {
    const g = emptyGrid(4, 4, MATERIAL_CELLS_PER_TILE)
    expect(g.w).toBe(8)
    stamp(g, { x: 1.2, y: 0.7 }, 1, 1)
    expect([...g.cells].indexOf(1)).toBe(1 * 8 + 2)
    expect(cellsToMap(g, { x: 3, y: 1 })).toEqual({ x: 1.5, y: 0.5 })
    stampStroke(g, { points: [{ x: 2, y: 2 }], radius: materialBrushRadius(0) }, 1)
    expect(count(g)).toBe(1 + 5)
  })
})
