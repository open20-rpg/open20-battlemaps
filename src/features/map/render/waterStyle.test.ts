import { describe, expect, it } from "vitest"
import {
  inkLineAlpha,
  mottle,
  paperTint,
  periodicNoise,
  rippleDashAlpha,
  rng,
  waterPixel,
} from "./waterStyle"

const column = (a: Uint8Array, w: number, h: number, x: number) =>
  Array.from({ length: h }, (_, y) => a[y * w + x])

describe("rng", () => {
  it("is deterministic per seed and in [0, 1)", () => {
    const a = rng(7)
    const b = rng(7)
    for (let i = 0; i < 100; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe("periodicNoise", () => {
  it("wraps seamlessly and stays in [-1, 1]", () => {
    const n = periodicNoise(512, 9, rng(3))
    for (const v of n) expect(Math.abs(v)).toBeLessThanOrEqual(1)
    // The step across the wrap is no bigger than any other neighbor step.
    const steps = Array.from(n, (v, i) => Math.abs(n[(i + 1) % n.length] - v))
    expect(steps[n.length - 1]).toBeLessThanOrEqual(Math.max(...steps.slice(0, -1)) + 1e-6)
  })
})

describe("inkLineAlpha", () => {
  const w = 256
  const h = 32
  const a = inkLineAlpha(w, h, 11)

  it("is solid ink in the middle and clear at the edges", () => {
    for (let x = 0; x < w; x += 17) {
      const col = column(a, w, h, x)
      expect(col[h / 2]).toBe(255)
      expect(col[0]).toBe(0)
      expect(col[h - 1]).toBe(0)
    }
  })

  it("varies its weight along the line", () => {
    const weights = Array.from({ length: w }, (_, x) =>
      column(a, w, h, x).reduce((s, v) => s + v, 0),
    )
    expect(Math.max(...weights) - Math.min(...weights)).toBeGreaterThan(255 * 2)
  })
})

describe("rippleDashAlpha", () => {
  const w = 2048
  const h = 16
  const a = rippleDashAlpha(w, h, 5)
  const covered = Array.from({ length: w }, (_, x) => column(a, w, h, x).some((v) => v > 0))

  it("draws separate strokes with gaps between them", () => {
    let strokes = 0
    for (let x = 1; x < w; x++) if (covered[x] && !covered[x - 1]) strokes++
    expect(strokes).toBeGreaterThan(3)
    const share = covered.filter(Boolean).length / w
    expect(share).toBeGreaterThan(0.2)
    expect(share).toBeLessThan(0.7)
  })

  it("leaves the wrap clear so no stroke is cut in half", () => {
    expect(covered[0]).toBe(false)
    expect(covered[w - 1]).toBe(false)
  })
})

describe("mottle", () => {
  it("is smooth, bounded and stable", () => {
    expect(mottle(1.3, 2.7)).toBe(mottle(1.3, 2.7))
    for (let i = 0; i < 200; i++) {
      const x = i * 0.137
      const v = mottle(x, x * 0.6)
      expect(Math.abs(v)).toBeLessThanOrEqual(1)
      expect(Math.abs(mottle(x + 0.01, x * 0.6) - v)).toBeLessThan(0.1)
    }
  })
})

describe("waterPixel", () => {
  const blue: [number, number, number] = [100, 160, 180]

  it("darkens and warms the color at the shore, fading out inside", () => {
    const shore = waterPixel(blue, 0, 0.5, 0.5)
    const inside = waterPixel(blue, 1, 0.5, 0.5)
    expect(shore[2]).toBeLessThan(inside[2] * 0.85)
    // Blue drops more than red: the wash is warm.
    expect(shore[2] / inside[2]).toBeLessThan(shore[0] / inside[0])
  })

  it("only mottles the color slightly away from the shore", () => {
    const p = waterPixel(blue, 2, 3.1, 4.2)
    for (let c = 0; c < 3; c++)
      expect(Math.abs(p[c] - blue[c])).toBeLessThanOrEqual(blue[c] * 0.06 + 1)
  })
})

describe("paperTint", () => {
  it("mixes toward warm paper white", () => {
    expect(paperTint([0, 0, 0], 0)).toBe(0)
    expect(paperTint([0, 0, 0], 1)).toBe(0xfff8e8)
  })
})
