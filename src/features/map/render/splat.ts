/**
 * Imported Dungeondraft terrain splats: one weight plane per texture (4
 * texels per tile), blended by drawing each texture over the ones below with
 * opacity w_k / (w_1 + … + w_k).
 *
 * That ratio must be taken AFTER interpolating the weights, not before:
 * interpolating ratios turns a stray weight of 1/255 next to an unrelated
 * texel into a 50% patch of that texture (gray specks in the water). So the
 * weights are upsampled bilinearly first and the ratios computed per output
 * pixel; what's left to the GPU's filtering is a fraction of a tile.
 */

/** Output pixels per splat texel. */
export const SPLAT_UPSAMPLE = 4

/**
 * Bilinear upsample of a `w`×`h` weight plane by `f`, sampling at texel
 * centers (edges clamp), so output pixel j lies over texel (j + 0.5) / f − 0.5.
 */
export function upsampleWeights(plane: Uint8Array, w: number, h: number, f: number): Float32Array {
  const ow = w * f
  const oh = h * f
  const out = new Float32Array(ow * oh)
  const at = (x: number, y: number) => plane[y * w + x] ?? 0
  for (let j = 0; j < oh; j++) {
    const v = Math.min(h - 1, Math.max(0, (j + 0.5) / f - 0.5))
    const y0 = Math.floor(v)
    const y1 = Math.min(h - 1, y0 + 1)
    const fy = v - y0
    for (let i = 0; i < ow; i++) {
      const u = Math.min(w - 1, Math.max(0, (i + 0.5) / f - 0.5))
      const x0 = Math.floor(u)
      const x1 = Math.min(w - 1, x0 + 1)
      const fx = u - x0
      const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx
      const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx
      out[j * ow + i] = top * (1 - fy) + bottom * fy
    }
  }
  return out
}

/**
 * Running sum of the weights stacked so far. `push` adds a texture's
 * (upsampled) weights and returns its layer opacity (0..255) per pixel.
 */
export class SplatStack {
  private sum: Float32Array | null = null

  push(weights: Float32Array): Uint8Array {
    this.sum ??= new Float32Array(weights.length)
    const sum = this.sum
    const out = new Uint8Array(weights.length)
    for (let i = 0; i < weights.length; i++) {
      sum[i] += weights[i]
      out[i] = sum[i] > 0 ? Math.round((weights[i] / sum[i]) * 255) : 0
    }
    return out
  }
}

/** Pseudo-random value in [0, 1) for an integer lattice point (deterministic). */
function lattice(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1), one independent field per `seed`. */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = lattice(x0, y0, seed)
  const b = lattice(x0 + 1, y0, seed)
  const c = lattice(x0, y0 + 1, seed)
  const d = lattice(x0 + 1, y0 + 1, seed)
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
}

/** Noise cells per tile, and how far (in weight, 0..1) the noise can tip a blend. */
const NOISE_PER_TILE = 1.6
const NOISE_AMOUNT = 0.8
/** Weight margin over which the winning texture fades into the runner-up. */
const BLEND_BAND = 0.08

/**
 * Smooth Blending off: instead of mixing every texture by its weight, the
 * heaviest one at each point takes over, with a short irregular transition —
 * Dungeondraft's look (grass here, dirt there, a crisp path edge) rather than
 * an even wash. Each weight is jittered by its own noise field, then only the
 * ones within BLEND_BAND of the top survive. `planes` are upsampled weights
 * (0..255) over a `width`-px-wide grid at `pxPerTile`; they're rewritten.
 */
export function sharpenWeights(planes: Float32Array[], width: number, pxPerTile: number): void {
  const count = planes[0]?.length ?? 0
  const h = new Float32Array(planes.length)
  for (let i = 0; i < count; i++) {
    const x = ((i % width) + 0.5) / pxPerTile
    const y = (Math.floor(i / width) + 0.5) / pxPerTile
    let top = -Infinity
    for (let k = 0; k < planes.length; k++) {
      const w = planes[k][i] / 255
      if (w <= 0) {
        h[k] = -Infinity
        continue
      }
      const n =
        valueNoise(x * NOISE_PER_TILE, y * NOISE_PER_TILE, k) * 0.65 +
        valueNoise(x * NOISE_PER_TILE * 2.7, y * NOISE_PER_TILE * 2.7, k + 17) * 0.35
      h[k] = w + (n - 0.5) * NOISE_AMOUNT
      if (h[k] > top) top = h[k]
    }
    let sum = 0
    for (let k = 0; k < planes.length; k++) {
      h[k] = Math.max(0, h[k] - (top - BLEND_BAND))
      sum += h[k]
    }
    for (let k = 0; k < planes.length; k++) planes[k][i] = sum > 0 ? (h[k] / sum) * 255 : 0
  }
}

export function decodeBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
}
