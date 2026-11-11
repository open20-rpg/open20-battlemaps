/**
 * Terrain blending, as Dungeondraft does it (its Terrain.shader): the
 * terrain has up to 8 texture slots, each with a weight per point (imported
 * splats: 4 texels per tile, bilinearly filtered). The GPU version lives in
 * terrainFilter.ts; this is the same formula in TS, for tests and as its
 * reference.
 */

/** Texture slots of the terrain (Dungeondraft: 4, or 8 with expanded slots). */
export const TERRAIN_SLOTS = 8

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

export function decodeBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
}
