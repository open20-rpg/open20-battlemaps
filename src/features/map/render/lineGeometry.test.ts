import { describe, expect, it } from "vitest"
import {
  easeInOut,
  openLoop,
  pathAlpha,
  pathTriangles,
  pathWidths,
  smoothPath,
  wallTriangles,
  type LineVertex,
} from "./lineGeometry"

const L = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
]
const verts = (tris: { a: LineVertex; b: LineVertex; c: LineVertex }[]) =>
  tris.flatMap((t) => [t.a, t.b, t.c])
const at = (vs: LineVertex[], x: number, y: number) =>
  vs.filter((v) => Math.abs(v.x - x) < 1e-9 && Math.abs(v.y - y) < 1e-9)

describe("wall geometry (Line2D-style)", () => {
  it("a straight wall is one quad with u = distance", () => {
    const tris = wallTriangles([L[0], L[1]], false, 0.5, { bevel: true, normalizeUv: true })
    expect(tris).toHaveLength(2)
    const us = verts(tris).map((v) => v.u)
    expect(Math.min(...us)).toBe(0)
    expect(Math.max(...us)).toBe(4)
  })

  it("normalize_uv bevel: 4 sections around the corner, u = U ∓ hw, U ∓ hw/2", () => {
    const hw = 0.25
    const vs = verts(wallTriangles(L, false, 2 * hw, { bevel: true, normalizeUv: true }))
    // Turning right (+y): the inner side is the one toward (4−hw, hw).
    // Straight section before the corner, at p − f0·hw.
    expect(at(vs, 4 - hw, -hw).map((v) => v.u)).toContain(4 - hw)
    // The bevel's outer points: p ± normal·hw of each segment.
    expect(at(vs, 4, -hw).map((v) => v.u)).toContain(4 - hw / 2)
    expect(at(vs, 4 + hw, 0).map((v) => v.u)).toContain(4 + hw / 2)
    // Straight section after the corner, at p + f1·hw.
    expect(at(vs, 4 + hw, hw).map((v) => v.u)).toContain(4 + hw)
    // The inner corner is the intersection of the inner edges.
    expect(at(vs, 4 - hw, hw).length).toBeGreaterThan(0)
    // u keeps measuring distance: the far end is at 8.
    expect(Math.max(...vs.map((v) => v.u))).toBe(8)
    // The bevel cut is hw·√2 long.
    expect(Math.hypot(hw, hw)).toBeCloseTo(hw * Math.SQRT2)
  })

  it("short segments: one stretched texture column; miter when asked", () => {
    const short = [
      { x: 0, y: 0 },
      { x: 0.4, y: 0 },
      { x: 0.4, y: 4 },
    ]
    const tris = wallTriangles(short, false, 0.5, { bevel: true, normalizeUv: true })
    // Quad, corner triangle, quad.
    expect(tris).toHaveLength(5)
    const corner = tris[2]
    expect(new Set([corner.a.u, corner.b.u, corner.c.u])).toEqual(new Set([0.4]))
    const mitered = verts(wallTriangles(L, false, 0.5, { bevel: false, normalizeUv: true }))
    expect(at(mitered, 4.25, -0.25).map((v) => v.u)).toContain(4)
  })

  it("round corners fan the outer side, 8 steps per half turn", () => {
    const tris = wallTriangles(L, false, 0.5, { bevel: true, normalizeUv: false, round: true })
    // Quad, a 90° fan (4 triangles), quad.
    expect(tris).toHaveLength(2 + 4 + 2)
    const fan = verts(tris.slice(2, 6))
    // Every fan point is on the circle of half-width around the corner, or the inner point.
    for (const v of fan) {
      const d = Math.hypot(v.x - 4, v.y)
      expect(
        d < 0.26 || Math.abs(d - 0.25) < 1e-9 || Math.abs(d - Math.hypot(0.25, 0.25)) < 1e-9,
      ).toBe(true)
    }
  })

  it("closed walls open at their closing segment's midpoint", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    expect(openLoop(square)).toEqual([{ x: 0, y: 2 }, ...square, { x: 0, y: 2 }])
    const vs = verts(wallTriangles(square, true, 0.5, { bevel: true, normalizeUv: true }))
    expect(Math.max(...vs.map((v) => v.u))).toBe(16)
  })
})

describe("path geometry (5-vertex sections)", () => {
  it("smooths with Chaikin at c = 0.05 + 0.2·smoothness, keeping the ends", () => {
    const pts = smoothPath(L, 1, false)
    expect(pts[0]).toEqual(L[0])
    expect(pts.at(-1)).toEqual(L[2])
    // 3 points → 4 iterations, each doubling them (ends kept): 3 → 6 → 12 → 24 → 48.
    expect(pts).toHaveLength(48)
    // Two points get their midpoint first (then smooth like three).
    expect(smoothPath([L[0], L[1]], 0, false)).toHaveLength(48)
  })

  it("loops come back open at their closing midpoint", () => {
    const pts = smoothPath([L[0], L[1], L[2], { x: 0, y: 4 }], 0.5, true)
    expect(pts[0]).toEqual(pts.at(-1))
  })

  it("grow/shrink ease over a third of the points, fades over 10% of the length", () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBe(0.5)
    expect(easeInOut(1)).toBe(1)
    const w = pathWidths(30, 2, true, false)
    expect(w[0]).toBe(0)
    expect(w[5]).toBeCloseTo(2 * easeInOut(0.5))
    expect(w[10]).toBe(2)
    expect(w[29]).toBe(2)
    expect(pathWidths(30, 2, false, true)[29]).toBe(0)
    expect(pathAlpha(0, true, false)).toBe(0)
    expect(pathAlpha(0.05, true, false)).toBeCloseTo(0.5)
    expect(pathAlpha(0.5, true, true)).toBe(1)
    expect(pathAlpha(1, false, true)).toBe(0)
  })

  it("5-vertex sections joined by 4 strips; u is the distance", () => {
    const tris = pathTriangles([L[0], L[1]], [1, 1], false, false)
    expect(tris).toHaveLength(8)
    expect(Math.max(...verts(tris).map((v) => v.u))).toBe(4)
    const faded = pathTriangles([L[0], L[1]], [1, 1], true, false)
    expect(faded.length).toBeGreaterThan(8)
    expect(Math.min(...faded.map((t) => t.alpha))).toBeLessThan(0.1)
  })
})
