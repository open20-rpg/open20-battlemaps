import { describe, expect, it } from "vitest"
import { stripTriangles, type StripVertex } from "./stripGeometry"

const L = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
]
const near = (a: StripVertex, x: number, y: number) =>
  Math.abs(a.x - x) < 1e-9 && Math.abs(a.y - y) < 1e-9

describe("strip geometry", () => {
  it("a straight strip is one rectangle with u running along it", () => {
    const tris = stripTriangles([L[0], L[1]], false, 0.5)
    expect(tris).toHaveLength(2)
    const us = tris.flatMap((t) => [t.a.u, t.b.u, t.c.u])
    expect(Math.min(...us)).toBe(0)
    expect(Math.max(...us)).toBe(4)
  })

  it("trims segments at a 90° corner and fills it continuously", () => {
    const tris = stripTriangles(L, false, 0.5)
    // 2 rectangles (2 triangles each) + 2 corner triangles.
    expect(tris).toHaveLength(6)
    const [, firstRect2, corner1, corner2, secondRect1] = tris
    // First rect ends trimmed by half-width·tan(45°) = 0.25 before the corner.
    expect(Math.max(firstRect2.a.u, firstRect2.b.u, firstRect2.c.u)).toBeCloseTo(3.75)
    // Corner advances u by 2·trim; the second rect starts exactly there.
    expect(corner1.a.u).toBeCloseTo(3.75)
    expect(corner2.b.u).toBeCloseTo(4.25)
    expect(Math.min(secondRect1.a.u, secondRect1.b.u, secondRect1.c.u)).toBeCloseTo(4.25)
    // Both corner triangles share the inner miter point.
    expect(near(corner1.c, 3.75, 0.25)).toBe(true)
    expect(near(corner2.c, 3.75, 0.25)).toBe(true)
    // The outer miter point is the strip's outer corner.
    expect(near(corner1.b, 4.25, -0.25)).toBe(true)
  })

  it("closes polygons with a corner at every vertex", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    expect(stripTriangles(square, true, 0.5)).toHaveLength(4 * 2 + 4 * 2)
  })

  it("supports per-point widths and opacities (path tapers and fades)", () => {
    const tris = stripTriangles([L[0], L[1]], false, [0, 1], [0, 1])
    const xs0 = tris.flatMap((t) => [t.a, t.b, t.c]).filter((v) => v.x === 0)
    expect(xs0.every((v) => v.y === 0)).toBe(true)
    expect(tris[0].alpha).toBe(0.5)
  })

  it("ignores repeated points", () => {
    expect(stripTriangles([L[0], L[0], L[1]], false, 0.5)).toHaveLength(2)
    expect(stripTriangles([L[0]], false, 0.5)).toEqual([])
  })

  it("keeps a closed outline when segments are shorter than the strip is wide", () => {
    // A tight zigzag with a wide strip: corners can't be fully trimmed.
    const zig = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.3 },
      { x: 0.6, y: 0 },
      { x: 0.9, y: 0.3 },
    ]
    const tris = stripTriangles(zig, false, 1)
    // 3 rectangles + 2 fanned corners (4 triangles each).
    expect(tris).toHaveLength(3 * 2 + 2 * 4)
    expect(
      tris.every((t) => [t.a, t.b, t.c].every((v) => Number.isFinite(v.x) && Number.isFinite(v.u))),
    ).toBe(true)
  })
})
