import { describe, expect, it } from "vitest"
import { sdfFromCoverage } from "./sdf"

describe("sdfFromCoverage", () => {
  // A 20 × 20 image with a solid 8 × 8 square in the middle (cols/rows 6–13).
  const w = 20
  const alpha = new Uint8Array(w * w)
  for (let y = 6; y < 14; y++) for (let x = 6; x < 14; x++) alpha[y * w + x] = 255
  const field = sdfFromCoverage(alpha, w, w, 4)
  const at = (x: number, y: number) => field[y * w + x]

  it("is half on the edge, full deep inside, empty far outside", () => {
    expect(at(10, 10)).toBe(255)
    expect(at(0, 0)).toBe(0)
    // The edge lies between pixels 5 and 6: 0.5 px either side of it.
    expect(at(6, 10)).toBeGreaterThan(128)
    expect(at(5, 10)).toBeLessThan(128)
    expect((at(6, 10) + at(5, 10)) / 2).toBeCloseTo(127.5, 0)
  })

  it("falls off linearly over the radius", () => {
    expect(at(3, 10)).toBeLessThan(at(4, 10))
    expect(at(4, 10)).toBeLessThan(at(5, 10))
  })

  it("places a partly covered edge between pixels", () => {
    const soft = Uint8Array.from(alpha)
    for (let y = 6; y < 14; y++) soft[y * w + 5] = 128
    const moved = sdfFromCoverage(soft, w, w, 4)
    // Half coverage puts the edge through pixel 5's center.
    expect(moved[10 * w + 5]).toBeGreaterThanOrEqual(127)
    expect(moved[10 * w + 5]).toBeLessThanOrEqual(129)
  })
})
