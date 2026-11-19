import { describe, expect, it } from "vitest"
import { tiledMesh } from "./tiling"

describe("tiledMesh", () => {
  const rect = { x: -812.5, y: 301, w: 37, h: 9.5 }

  it("covers the rectangle with quads", () => {
    const m = tiledMesh(rect, { x: 0, y: 0 }, 0.4, 1.5, 1)
    const xs = [...m.positions].filter((_, i) => i % 2 === 0)
    const ys = [...m.positions].filter((_, i) => i % 2 === 1)
    expect(Math.min(...xs)).toBeCloseTo(rect.x)
    expect(Math.max(...xs)).toBeCloseTo(rect.x + rect.w)
    expect(Math.min(...ys)).toBeCloseTo(rect.y)
    expect(Math.max(...ys)).toBeCloseTo(rect.y + rect.h)
    expect(m.indices.length).toBe((m.positions.length / 8) * 6)
  })

  it("never scales the texture, whatever the size: it only turns", () => {
    for (const r of [rect, { x: 3, y: 4, w: 2, h: 60 }]) {
      const tw = 1.5
      const th = 0.75
      const m = tiledMesh(r, { x: 7.25, y: -3 }, 1.1, tw, th)
      // Within each quad, texture distances (in tiles) equal map distances.
      for (let q = 0; q < m.positions.length / 8; q++) {
        const p = (i: number) => ({
          x: m.positions[q * 8 + i * 2],
          y: m.positions[q * 8 + i * 2 + 1],
        })
        const t = (i: number) => ({
          x: m.uvs[q * 8 + i * 2] * tw,
          y: m.uvs[q * 8 + i * 2 + 1] * th,
        })
        for (const [a, b] of [
          [0, 1],
          [1, 2],
          [0, 2],
        ]) {
          const dp = Math.hypot(p(b).x - p(a).x, p(b).y - p(a).y)
          const dt = Math.hypot(t(b).x - t(a).x, t(b).y - t(a).y)
          expect(dt).toBeCloseTo(dp, 3)
        }
      }
    }
  })

  it("keeps uvs small and on the lattice laid from the origin", () => {
    const origin = { x: -800.3, y: 302.1 }
    const m = tiledMesh(rect, origin, 0.4, 1.5, 1)
    expect(Math.max(...m.uvs.map(Math.abs))).toBeLessThan(8)
    // A quad corner's uv differs from the true one by whole repeats.
    const [x, y] = [m.positions[0], m.positions[1]]
    const dx = x - origin.x
    const dy = y - origin.y
    const u = (dx * Math.cos(0.4) + dy * Math.sin(0.4)) / 1.5
    const v = (-dx * Math.sin(0.4) + dy * Math.cos(0.4)) / 1
    expect(Math.abs(u - m.uvs[0] - Math.round(u - m.uvs[0]))).toBeLessThan(1e-3)
    expect(Math.abs(v - m.uvs[1] - Math.round(v - m.uvs[1]))).toBeLessThan(1e-3)
  })
})
