import { describe, expect, it } from "vitest"
import { distanceField, isoContours, rampAt, simplifyLoop, waterRamp } from "./fields"

/** A w × h mask with a filled rectangle [x0, x1) × [y0, y1). */
function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const m = new Uint8Array(w * h)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1
  return m
}

describe("raster fields", () => {
  it("measures each inside cell's distance to the outside", () => {
    const d = distanceField(rect(9, 9, 1, 1, 8, 8), 9, 9)
    expect(d[0]).toBe(0)
    expect(d[1 * 9 + 1]).toBe(1)
    // The center is 4 cells from the outside on every side.
    expect(d[4 * 9 + 4]).toBe(4)
  })

  it("traces closed iso-contours, one per region and hole", () => {
    const w = 10
    const m = rect(w, w, 1, 1, 9, 9)
    for (let y = 4; y < 6; y++) for (let x = 4; x < 6; x++) m[y * w + x] = 0
    const field = Float32Array.from(m)
    const loops = isoContours(field, w, w, 0.5)
    expect(loops).toHaveLength(2)
    // The outer loop runs around the filled area's edge (cells 1–8 → 1…9).
    const xs = loops.flat().map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(1)
    expect(Math.max(...xs)).toBeCloseTo(9)
  })

  it("simplifies straight runs away", () => {
    const loop = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]
    expect(simplifyLoop(loop, 0.01)).toHaveLength(4)
  })

  it("ramps water from shallow to deep by Dungeondraft's rings", () => {
    expect(waterRamp(1.5)).toEqual([
      { d: 0, t: 0 },
      { d: 0.333, t: 0.333 / 1.5 },
      { d: 0.75, t: 0.5 },
      { d: 1.5, t: 1 },
    ])
    const r = waterRamp(1.5)
    expect(rampAt(r, 0)).toBe(0)
    expect(rampAt(r, 0.75)).toBeCloseTo(0.5)
    expect(rampAt(r, 9)).toBe(1)
    // A short blend: one ring, clipped to it.
    expect(waterRamp(0.2)).toEqual([
      { d: 0, t: 0 },
      { d: 0.2, t: 1 },
    ])
  })
})
