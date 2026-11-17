import { type Vec2 } from "./types"

/**
 * The terrain of a level: a splat of per-slot weights, 4 texels per tile,
 * one byte per slot (up to 8 slots). Painting is an exact byte-level blend
 * (see blendTowards); rendering blends the slot textures from these weights
 * (render/terrainFilter.ts).
 *
 * Texel x runs along world x (map x mirrored: texel column 0 is the map's
 * left edge on screen, where map x = width).
 */

/** Texture slots (4, or 8 with expanded slots). */
export const TERRAIN_SLOTS = 8
export const TEXELS_PER_TILE = 4
/** Painting runs on a fixed 60 Hz clock (one stamp per frame at 60 fps). */
export const TERRAIN_TICK = 1 / 60

export interface TerrainData {
  /** Size in texels (map tiles × 4). */
  width: number
  height: number
  /** Asset id of each slot's texture (null = empty slot). */
  slots: (string | null)[]
  /** Base64 of width × height × 8 bytes: texel-major, one byte per slot. */
  weights: string
}

export function encodeWeights(bytes: Uint8Array): string {
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

export function decodeWeights(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
}

/** Every texel fully in `slot` (a new terrain, or Fill). */
export function filledWeights(width: number, height: number, slot: number): Uint8Array {
  const bytes = new Uint8Array(width * height * TERRAIN_SLOTS)
  for (let t = 0; t < width * height; t++) bytes[t * TERRAIN_SLOTS + slot] = 255
  return bytes
}

/** A new terrain for a map of `tiles` size, all in slot 0. */
export function createTerrain(
  tiles: { width: number; height: number },
  slots: (string | null)[],
): TerrainData {
  const width = tiles.width * TEXELS_PER_TILE
  const height = tiles.height * TEXELS_PER_TILE
  return { width, height, slots, weights: encodeWeights(filledWeights(width, height, 0)) }
}

/**
 * Resize to a map of `tiles` size, keeping the overlap (anchored at texel
 * 0,0) and filling new texels with slot 0.
 */
export function resizeTerrain(
  data: TerrainData,
  tiles: { width: number; height: number },
): TerrainData {
  const width = tiles.width * TEXELS_PER_TILE
  const height = tiles.height * TEXELS_PER_TILE
  if (width === data.width && height === data.height) return data
  const src = decodeWeights(data.weights)
  const out = filledWeights(width, height, 0)
  for (let y = 0; y < Math.min(height, data.height); y++) {
    for (let x = 0; x < Math.min(width, data.width); x++) {
      const from = (y * data.width + x) * TERRAIN_SLOTS
      out.set(src.subarray(from, from + TERRAIN_SLOTS), (y * width + x) * TERRAIN_SLOTS)
    }
  }
  return { ...data, width, height, weights: encodeWeights(out) }
}

/**
 * The brush mask for a Size (diameter in tiles): a soft circle of 4·Size
 * texels, a linear cone ≈ 0.48·(1 − r) sampled at texel centers, quantized
 * to bytes like an 8-bit image.
 */
export function brushMask(size: number): { side: number; alpha: Float32Array } {
  const side = Math.max(1, Math.round(size * TEXELS_PER_TILE))
  const alpha = new Float32Array(side * side)
  const c = side / 2
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const r = Math.hypot(i + 0.5 - c, j + 0.5 - c) / c
      alpha[j * side + i] = Math.floor(Math.max(0, 0.48 * (1 - r)) * 255) / 255
    }
  }
  return { side, alpha }
}

/**
 * Top-left texel of a stamp centered at map point `p` (tiles) on a map
 * `mapWidth` tiles wide: trunc((mouse_px − Size·128) / 64),
 * so the stamp sits on the texel grid.
 */
export function stampOrigin(p: Vec2, size: number, mapWidth: number): { x: number; y: number } {
  const worldX = mapWidth - p.x
  return {
    x: Math.trunc(worldX * TEXELS_PER_TILE - size * 2),
    y: Math.trunc(p.y * TEXELS_PER_TILE - size * 2),
  }
}

const f32 = Math.fround

/**
 * One stamp of the brush on slot `slot` with strength `delta` (Intensity ×
 * frame time). The painted slot gains mask × delta (capped at 1); every other slot is rescaled so all
 * still add up to 1; bytes are written back truncated (as Godot's RGBA8
 * set_pixel does), which is why tiny strengths never paint.
 */
export function blendTowards(
  weights: Uint8Array,
  width: number,
  height: number,
  mask: { side: number; alpha: Float32Array },
  origin: { x: number; y: number },
  slot: number,
  delta: number,
): void {
  const x0 = Math.max(0, origin.x)
  const y0 = Math.max(0, origin.y)
  const x1 = Math.min(width, origin.x + mask.side)
  const y1 = Math.min(height, origin.y + mask.side)
  const c = new Float32Array(TERRAIN_SLOTS)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const m = mask.alpha[(y - origin.y) * mask.side + (x - origin.x)]
      const base = (y * width + x) * TERRAIN_SLOTS
      let sum = 0
      for (let k = 0; k < TERRAIN_SLOTS; k++) {
        c[k] = f32(weights[base + k] / 255)
        sum = f32(sum + c[k])
      }
      const chan = c[slot]
      const others = f32(sum - chan)
      let v = f32(chan + f32(m * delta))
      let scale: number
      if (v > 1) {
        v = 1
        scale = 0
      } else {
        scale = others > 0 ? f32(f32(1 - v) / others) : 0
      }
      for (let k = 0; k < TERRAIN_SLOTS; k++) {
        const out = k === slot ? v : f32(c[k] * scale)
        weights[base + k] = Math.min(255, Math.max(0, Math.trunc(out * 255)))
      }
    }
  }
}
