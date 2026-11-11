/**
 * The map document model: plain data, no React. This is what gets serialized
 * to/from the `.opdr` file (features/map/io) and what the viewport renders.
 * Keep it JSON-serializable and free of functions/class instances so undo
 * snapshots and file IO stay trivial.
 *
 * Coordinates are in tiles (1 unit = 1 grid cell), map space: x = 0 at the
 * map's right edge growing leftward, y = 0 at the top growing downward (see
 * render/viewport.ts for why x is mirrored).
 */

export interface Vec2 {
  x: number
  y: number
}

/**
 * One brush stroke (Cave, Water, Terrain, Material): a centerline sampled as
 * points plus the brush radius. Painted tools composite every stroke of their
 * tool on a level, in document order, so each stroke stays an undoable entity.
 */
export interface BrushStroke {
  points: Vec2[]
  /** Brush radius in tiles. */
  radius: number
  /** Removes previously painted area instead of adding to it (Cave "Blast Open"). */
  erase?: boolean
}

/**
 * One placed thing on the map (an object, a wall run, a path, a light…).
 * `toolId` records which tool created it (and so which renderer draws it);
 * `params` snapshots the tool params that matter for rendering it (asset
 * selection, color, layer…), so changing the tool's current params never
 * mutates already-placed entities. Geometry fields are optional because each
 * kind of entity uses a different subset of them.
 */
export interface MapEntity {
  id: string
  toolId: string
  /** Z-order bucket; one of MAP_LAYERS' values. */
  layer: number
  /** Level (floor) the entity belongs to; see {@link MapDocument.levels}. */
  level?: string
  /** Anchor point: center of objects/lights/text, origin of shapes. */
  position: Vec2
  /** Degrees, clockwise on screen. */
  rotation: number
  /** Uniform scale multiplier (objects, portals). Defaults to 1. */
  scale?: number
  /** Sprite mirrored left↔right / top↔bottom, in its own frame (before rotation). */
  flipX?: boolean
  flipY?: boolean
  /** Vertices of polylines/polygons (walls, paths, floors, patterns, roofs), absolute. */
  points?: Vec2[]
  /** Whether `points` form a closed polygon (vs. an open polyline). */
  closed?: boolean
  /** Painted area of brush tools. */
  strokes?: BrushStroke[]
  /**
   * Group id: entities sharing it select, move and transform together
   * (Select's Group / Ungroup).
   */
  group?: string
  /** Text content (Text tool). */
  text?: string
  params: Record<string, unknown>
}

/** A floor/level of the map. Only the active level is edited and drawn on top. */
export interface MapLevel {
  id: string
  /** User-given name; empty means "unnamed" (the UI shows a numbered label). */
  name: string
}

/** Map-wide lighting settings (Environment tool). */
export interface MapEnvironment {
  /** Ambient light color; white means "fully lit". */
  ambientLight: string
}

/** A traced-over image shown under the map (Reference Image tool). */
export interface ReferenceImage {
  /** Absolute file path on disk (loaded through the backend). */
  path: string
  opacity: number
  visible: boolean
  /** Corner with the smallest map coordinates (screen top-right, as map x is mirrored). */
  position: Vec2
  /** Width in tiles; height follows the image's aspect ratio. */
  width: number
}

export interface MapDocument {
  /** Dimensions in tiles. */
  width: number
  height: number
  entities: MapEntity[]
  levels: MapLevel[]
  environment: MapEnvironment
  referenceImage?: ReferenceImage | null
}

export const DEFAULT_LEVEL_ID = "level-1"
export const DEFAULT_AMBIENT_LIGHT = "#ffffff"

export function createDocument(width: number, height: number): MapDocument {
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    entities: [],
    levels: [{ id: DEFAULT_LEVEL_ID, name: "" }],
    environment: { ambientLight: DEFAULT_AMBIENT_LIGHT },
    referenceImage: null,
  }
}

/**
 * Upgrade a document from an older save (before levels/environment existed)
 * to the current shape, filling every missing field with its default. Entities
 * without a level land on the first level.
 */
export function normalizeDocument(
  doc: Partial<MapDocument> & Pick<MapDocument, "width" | "height">,
): MapDocument {
  const base = createDocument(doc.width, doc.height)
  const levels = doc.levels && doc.levels.length > 0 ? doc.levels : base.levels
  const fallbackLevel = levels[0].id
  return {
    ...base,
    ...doc,
    levels,
    environment: { ...base.environment, ...doc.environment },
    referenceImage: doc.referenceImage ?? null,
    entities: (doc.entities ?? []).map((e) => (e.level ? e : { ...e, level: fallbackLevel })),
  }
}
