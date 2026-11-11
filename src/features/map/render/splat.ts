/**
 * Terrain blending, as Dungeondraft does it (its Terrain.shader): the
 * terrain has up to 8 texture slots, each with a weight per point (imported
 * splats: 4 texels per tile, bilinearly filtered). The GPU version lives in
 * terrainFilter.ts; this is the same formula in TS, for tests and as its
 * reference.
 */

import { TERRAIN_SLOTS } from "../model/terrain"

export { TERRAIN_SLOTS }

/** Height margin within which slots mix (Dungeondraft's `blend_step`). */
export const TERRAIN_BLEND_STEP = 0.04

/**
 * Each slot's share of the color at one point with Smooth Blending off.
 * `heights` are texture alpha × weight (0..1): the highest slot wins and
 * only those within TERRAIN_BLEND_STEP of it mix in, by how far above the
 * cut they are.
 */
export function heightBlend(heights: readonly number[]): number[] {
  const top = Math.max(0, ...heights)
  const start = top - TERRAIN_BLEND_STEP
  const s = heights.map((h) => Math.max(h - start, 0))
  const sum = s.reduce((a, b) => a + b, 0)
  return s.map((v) => (sum > 0 ? v / sum : 0))
}

/**
 * Pack texel-major slot weights (8 bytes per texel) into three RGBA images
 * for the GPU: slot i in channel i % 3 of image ⌊i / 3⌋, alpha opaque.
 */
export function packWeights(weights: Uint8Array, out: Uint8Array[]): void {
  const texels = weights.length / TERRAIN_SLOTS
  for (let t = 0; t < texels; t++) {
    for (let r = 0; r < 3; r++) {
      const o = out[r]
      for (let c = 0; c < 3; c++) {
        const slot = r * 3 + c
        o[t * 4 + c] = slot < TERRAIN_SLOTS ? weights[t * TERRAIN_SLOTS + slot] : 0
      }
      o[t * 4 + 3] = 255
    }
  }
}
