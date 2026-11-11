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

export function decodeBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
}
