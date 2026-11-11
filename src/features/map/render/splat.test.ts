import { describe, expect, it } from "vitest"
import { TERRAIN_BLEND_STEP, heightBlend } from "./splat"

describe("terrain height blending", () => {
  it("lets the highest slot win outright when the others are far below", () => {
    // A cobblestone (alpha 0.78) at weight 0.4 beats grass (alpha 0.3) at 0.6.
    expect(heightBlend([0.3 * 0.6, 0.78 * 0.4])).toEqual([0, 1])
  })

  it("mixes only the slots within blend_step of the top", () => {
    const [a, b, c] = heightBlend([0.5, 0.5 - TERRAIN_BLEND_STEP / 2, 0.1])
    expect(a).toBeCloseTo(2 / 3)
    expect(b).toBeCloseTo(1 / 3)
    expect(c).toBe(0)
  })

  it("mixes every slot evenly where none has weight (as Dungeondraft does)", () => {
    expect(heightBlend([0, 0])).toEqual([0.5, 0.5])
  })
})
