/**
 * The map document model: plain data, no React. This is what gets serialized
 * to/from the Dungeondraft map format (features/map/io, future) and what the
 * viewport renders. It will grow with the editor — keep it JSON-serializable
 * and free of functions/class instances so undo snapshots and file IO stay
 * trivial.
 */

export interface Vec2 {
  x: number
  y: number
}

/**
 * One placed thing on the map (an object, a wall run, a path, …). `toolId`
 * records which tool created it; `params` snapshots the tool params that
 * matter for rendering it (asset selection, color, layer…), so changing the
 * tool's current params never mutates already-placed entities.
 */
export interface MapEntity {
  id: string
  toolId: string
  /** Z-order bucket; one of MAP_LAYERS' values. */
  layer: number
  position: Vec2
  rotation: number
  params: Record<string, unknown>
}

export interface MapDocument {
  /** Dimensions in tiles. */
  width: number
  height: number
  entities: MapEntity[]
}

export function createDocument(width: number, height: number): MapDocument {
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    entities: [],
  }
}
