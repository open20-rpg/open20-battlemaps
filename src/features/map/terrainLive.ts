import { decodeWeights, encodeWeights, type TerrainData } from "./model/terrain"
import { type TexelRect } from "./render/splat"

/**
 * Terrain weights while a brush stroke is in progress. Painting runs at
 * 60 Hz on a decoded byte buffer instead of rewriting the document every
 * tick; the renderer reads that buffer live, and the stroke lands in the
 * document once, on release (one undo step) with its before and after
 * weights.
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
/** Texels painted since the renderer last caught up, and whether it must redo everything. */
let dirty: TexelRect | null = null
let dirtyAll = false
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

/**
 * Announce a painted tick; `rect` is what it changed (the renderer then
 * redraws just that), none means everything.
 */
export function touchLiveTerrain(rect?: TexelRect): void {
  if (!rect) dirtyAll = true
  else
    dirty = dirty
      ? {
          x0: Math.min(dirty.x0, rect.x0),
          y0: Math.min(dirty.y0, rect.y0),
          x1: Math.max(dirty.x1, rect.x1),
          y1: Math.max(dirty.y1, rect.y1),
        }
      : rect
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

/**
 * What was painted since the last call: a rectangle, or null when it all
 * has to be redrawn.
 */
export function takeLiveDirty(): TexelRect | null {
  const rect = dirtyAll ? null : dirty
  dirty = null
  dirtyAll = false
  return rect
}

export function subscribeLiveTerrain(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
