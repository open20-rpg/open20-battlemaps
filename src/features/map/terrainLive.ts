import { decodeWeights, encodeWeights, type TerrainData } from "./model/terrain"

/**
 * Terrain weights while a brush stroke is in progress. Painting runs at
 * 60 Hz on a decoded byte buffer instead of rewriting the document every
 * tick; the renderer reads that buffer live, and the stroke lands in the
 * document once, on release (one undo step), like Dungeondraft's
 * PaintTerrain(before, after).
 */

/** Decoded weights per terrain value, so unchanged terrain is never re-decoded. */
const decoded = new WeakMap<TerrainData, Uint8Array>()

export function weightsOf(data: TerrainData): Uint8Array {
  let bytes = decoded.get(data)
  if (!bytes) {
    bytes = decodeWeights(data.weights)
    decoded.set(data, bytes)
  }
  return bytes
}

interface Live {
  entityId: string
  bytes: Uint8Array
}

let live: Live | null = null
let version = 0
const listeners = new Set<() => void>()

/** Start painting `entityId`'s terrain: a private copy of its weights. */
export function beginLiveTerrain(entityId: string, data: TerrainData): Uint8Array {
  live = { entityId, bytes: weightsOf(data).slice() }
  return live.bytes
}

/** The in-progress weights of `entityId`, if it's being painted. */
export function liveTerrain(entityId: string): Uint8Array | null {
  return live?.entityId === entityId ? live.bytes : null
}

/** Bumped on every painted tick (the renderer re-uploads when it changes). */
export const liveTerrainVersion = (): number => version

export function touchLiveTerrain(): void {
  version++
  for (const fn of listeners) fn()
}

/** Finish: the stroke's result as a new terrain value (already decoded, for the renderer). */
export function endLiveTerrain(data: TerrainData): TerrainData | null {
  if (!live) return null
  const next = { ...data, weights: encodeWeights(live.bytes) }
  decoded.set(next, live.bytes)
  live = null
  touchLiveTerrain()
  return next
}

export function subscribeLiveTerrain(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
