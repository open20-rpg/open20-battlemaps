import { describe, expect, it } from "vitest"
import { latticeOrigin } from "./tiling"

/** Whether `p` and `q` differ by whole repeats of the turned `w` × `h` lattice. */
function sameLattice(
  p: { x: number; y: number },
  q: { x: number; y: number },
  rot: number,
  w: number,
  h: number,
) {
  const dx = p.x - q.x
  const dy = p.y - q.y
  const i = (dx * Math.cos(rot) + dy * Math.sin(rot)) / w
  const j = (-dx * Math.sin(rot) + dy * Math.cos(rot)) / h
  return Math.abs(i - Math.round(i)) < 1e-9 && Math.abs(j - Math.round(j)) < 1e-9
}

describe("latticeOrigin", () => {
  it("wraps an unrotated offset into the first repeat", () => {
    const o = latticeOrigin({ x: -37.25, y: 5120 }, 0, 2, 1.5)
    expect(o.x).toBeCloseTo(0.75)
    expect(o.y).toBeCloseTo(0.5)
  })

  it("stays on the same (rotated) lattice, within one repeat", () => {
    for (const rot of [0.3, -1.2, Math.PI / 2, 2.9]) {
      const offset = { x: 813.4, y: -2048.7 }
      const o = latticeOrigin(offset, rot, 1.5, 1)
      expect(sameLattice(o, offset, rot, 1.5, 1)).toBe(true)
      expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(Math.hypot(1.5, 1) + 1e-9)
    }
  })
})
