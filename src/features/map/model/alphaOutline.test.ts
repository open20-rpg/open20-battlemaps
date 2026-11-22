import { describe, expect, it } from "vitest"
import { alphaOutline } from "./alphaOutline"
import { pointInPolygon } from "./geometry"

/** A w×h image with alpha 255 where `opaque(x, y)`. */
const image = (w: number, h: number, opaque: (x: number, y: number) => boolean) => {
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = opaque(x, y) ? 255 : 0
  return { w, h, data }
}

describe("alphaOutline", () => {
  it("outlines a round prop as one simplified loop, not its square", () => {
    const disc = image(128, 128, (x, y) => Math.hypot(x - 63.5, y - 63.5) < 40)
    const loops = alphaOutline(disc)
    expect(loops).toHaveLength(1)
    expect(loops[0].length).toBeGreaterThan(6)
    expect(loops[0].length).toBeLessThan(60)
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, loops[0])).toBe(true)
    // The image's corners are transparent: outside the silhouette.
    expect(pointInPolygon({ x: 0.08, y: 0.08 }, loops[0])).toBe(false)
  })

  it("keeps separate parts, drops specks and holes", () => {
    const img = image(256, 64, (x, y) => {
      const ring = Math.hypot(x - 32, y - 32)
      return (
        (ring < 28 && ring > 12) ||
        (x > 150 && x < 240 && y > 10 && y < 54) ||
        (x === 100 && y === 5)
      )
    })
    const loops = alphaOutline(img)
    expect(loops).toHaveLength(2)
    // The ring's hole is inside its outer outline (no separate loop for it).
    expect(loops.some((l) => pointInPolygon({ x: 32 / 256, y: 0.5 }, l))).toBe(true)
  })

  it("gives nothing for a fully transparent image", () => {
    expect(alphaOutline(image(32, 32, () => false))).toEqual([])
  })
})
