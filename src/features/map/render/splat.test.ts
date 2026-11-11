import { describe, expect, it } from "vitest"
import { SplatStack, sharpenWeights, upsampleWeights, valueNoise } from "./splat"

describe("terrain splats", () => {
  it("upsamples weights bilinearly between texel centers", () => {
    const up = upsampleWeights(Uint8Array.of(0, 200), 2, 1, 2)
    // Pixels at texel coords -0.25 (clamped), 0.25, 0.75, 1.25 (clamped).
    expect([...up.subarray(0, 4)]).toEqual([0, 50, 150, 200])
  })

  it("stacks layer opacities as w_k / (w_1 + … + w_k)", () => {
    const stack = new SplatStack()
    stack.push(Float32Array.of(128, 0))
    const l2 = stack.push(Float32Array.of(64, 0))
    const l3 = stack.push(Float32Array.of(64, 0))
    expect(l2[0]).toBe(85) // 64/192
    expect(l3[0]).toBe(64) // 64/256
    expect(l2[1]).toBe(0)
  })

  it("keeps a stray weight a stray weight after interpolation", () => {
    // Base | flagstone: texel A all water-2 with a 1/255 flagstone trace,
    // texel B all base. Between them, flagstone must stay ≈ 0, not jump to 50%.
    const f = 2
    const stack = new SplatStack()
    stack.push(upsampleWeights(Uint8Array.of(0, 255), 2, 1, f))
    const flag = stack.push(upsampleWeights(Uint8Array.of(1, 0), 2, 1, f))
    stack.push(upsampleWeights(Uint8Array.of(254, 0), 2, 1, f))
    expect(flag[1]).toBeLessThanOrEqual(3) // 0.75 / (0.75 + 0.25·255) ≈ 1%
  })

  it("lets the heaviest texture take over when Smooth Blending is off", () => {
    // A 10×10-tile near-even grass/dirt mix (16 px per tile) plus one pure-grass pixel.
    const n = 160 * 160
    const grass = new Float32Array(n + 1).fill(140)
    const dirt = new Float32Array(n + 1).fill(114)
    grass[n] = 255
    dirt[n] = 0
    sharpenWeights([grass, dirt], 160, 16)
    const share = (pred: (g: number) => boolean) =>
      [...grass.subarray(0, n)].filter(pred).length / n
    // Most points pick one texture (no even 55/45 wash); the heavier one wins more.
    expect(share((g) => g > 230)).toBeGreaterThan(0.4)
    expect(share((g) => g < 25)).toBeGreaterThan(0.1)
    expect(grass[5] + dirt[5]).toBeCloseTo(255)
    // A pure pixel stays pure.
    expect(grass[n]).toBeCloseTo(255)
  })

  it("value noise is smooth, bounded and deterministic", () => {
    const a = valueNoise(3.2, 7.7, 1)
    expect(a).toBe(valueNoise(3.2, 7.7, 1))
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
    expect(Math.abs(valueNoise(3.2, 7.7, 1) - valueNoise(3.21, 7.7, 1))).toBeLessThan(0.05)
  })
})
