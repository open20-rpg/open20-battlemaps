import { describe, expect, it } from "vitest"
import {
  TERRAIN_SLOTS,
  TERRAIN_TICK,
  blendTowards,
  brushMask,
  createTerrain,
  decodeWeights,
  resizeTerrain,
  stampOrigin,
} from "./terrain"

/** One texel at (143, 111, 0, 0), painted on slot 3 with a mask of 121/255. */
function texel(): Uint8Array {
  const w = new Uint8Array(TERRAIN_SLOTS)
  w[0] = 143
  w[1] = 111
  return w
}
const mask = { side: 1, alpha: Float32Array.of(121 / 255) }
const tick = (w: Uint8Array, intensity: number) =>
  blendTowards(w, 1, 1, mask, { x: 0, y: 0 }, 3, intensity * TERRAIN_TICK)
const first4 = (w: Uint8Array) => [...w.subarray(0, 4)]

describe("terrain painting (blend towards a slot)", () => {
  it("matches the reference weights at Intensity 4, 60 Hz", () => {
    const w = texel()
    tick(w, 4)
    expect(first4(w)).toEqual([139, 107, 0, 8])
    tick(w, 4)
    expect(first4(w)).toEqual([135, 103, 0, 16])
    let ticks = 2
    while (w[3] < 255 && ticks < 1000) {
      tick(w, 4)
      ticks++
    }
    expect(ticks).toBe(32) // 0.53 s
    expect(first4(w)).toEqual([0, 0, 0, 255])
  })

  it("matches the reference weights at Intensity 1", () => {
    const w = texel()
    tick(w, 1)
    expect(first4(w)).toEqual([142, 110, 0, 2])
    tick(w, 1)
    expect(first4(w)).toEqual([141, 109, 0, 4])
  })

  it("never paints at Intensity 0.2 (the gain truncates to 0)", () => {
    const w = texel()
    for (let i = 0; i < 300; i++) tick(w, 0.2)
    expect(first4(w)).toEqual([143, 111, 0, 0])
  })

  it("brush mask is a cone, ~0.47 at the center, 4 texels per tile", () => {
    const m = brushMask(8)
    expect(m.side).toBe(32)
    const center = m.alpha[16 * 32 + 16]
    expect(center).toBeGreaterThan(0.45)
    expect(center).toBeLessThan(0.48)
    expect(m.alpha[0]).toBe(0) // corner, outside the circle
  })

  it("stamps on the texel grid, centered on the pointer (x mirrored)", () => {
    // Map 10 tiles wide: map x 5 is world tile 5 → texel 20; size 2 → −4.
    expect(stampOrigin({ x: 5, y: 3 }, 2, 10)).toEqual({ x: 16, y: 8 })
  })

  it("clips stamps at the map's edges", () => {
    const w = new Uint8Array(2 * 2 * TERRAIN_SLOTS)
    for (let t = 0; t < 4; t++) w[t * TERRAIN_SLOTS] = 255
    blendTowards(w, 2, 2, brushMask(1), { x: -2, y: -2 }, 1, 100)
    // The mask's lower-right quarter lands on texels (0,0)…(1,1): its center
    // texel paints fully, the circle's outside corner not at all.
    expect(w[1]).toBe(255)
    expect(w[TERRAIN_SLOTS * 3 + 1]).toBe(0)
  })

  it("creates and resizes terrain, new texels in slot 0", () => {
    const t = createTerrain({ width: 2, height: 1 }, ["a", null])
    expect([t.width, t.height]).toEqual([8, 4])
    const bigger = resizeTerrain(t, { width: 3, height: 2 })
    expect([bigger.width, bigger.height]).toEqual([12, 8])
    const bytes = decodeWeights(bigger.weights)
    expect(bytes[0]).toBe(255)
    expect(bytes[(12 * 8 - 1) * TERRAIN_SLOTS]).toBe(255)
  })
})
