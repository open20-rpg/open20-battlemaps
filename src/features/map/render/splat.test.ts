import { describe, expect, it } from "vitest"
import { SplatStack, upsampleWeights } from "./splat"

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
})
