import { squaredEdt } from "./fields"

const INF = 1e20

/**
 * A signed distance field from antialiased coverage (`alpha`, one byte per
 * pixel, w × h): 0.5 (128) on the shape's edge, rising inside and falling
 * outside, reaching 1 / 0 at `radius` px. Partly covered pixels seed both
 * distances with their sub-pixel offset (coverage 0.3 is 0.2 px outside the
 * edge), so the edge stays smooth however far the field is magnified.
 */
export function sdfFromCoverage(
  alpha: ArrayLike<number>,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  const n = w * h
  const outer = new Float64Array(n)
  const inner = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const c = alpha[i] / 255
    if (c >= 1) {
      outer[i] = 0
      inner[i] = INF
    } else if (c <= 0) {
      outer[i] = INF
      inner[i] = 0
    } else {
      const d = 0.5 - c
      outer[i] = d > 0 ? d * d : 0
      inner[i] = d < 0 ? d * d : 0
    }
  }
  squaredEdt(outer, w, h)
  squaredEdt(inner, w, h)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const dist = Math.sqrt(outer[i]) - Math.sqrt(inner[i])
    out[i] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - dist / (2 * radius))))
  }
  return out
}
