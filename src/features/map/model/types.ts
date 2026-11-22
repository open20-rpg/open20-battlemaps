/**
 * The map document model: plain data, no React. This is what gets serialized
 * to/from the `.otbm` file (features/map/io) and what the viewport renders.
 * Keep it JSON-serializable and free of functions/class instances so undo
 * snapshots and file IO stay trivial.
 *
 * Coordinates are in tiles (1 unit = 1 grid cell), map space: x = 0 at the
 * map's right edge growing leftward, y = 0 at the top growing downward (see
 * render/viewport.ts for why x is mirrored).
 */

import { DEFAULT_POST_PROCESS, POST_FILTERS, type PostProcess } from "../../../lib/postProcess"

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
  /** Removes previously painted area instead of adding to it (Alt). */
  erase?: boolean
  /**
   * Cave "Blast Open": paints the cave's blasted area (the entrance
   * bitmap) instead of digging — the floor fades out there and the
   * walls open. With `erase`, un-blasts.
   */
  blast?: boolean
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
  /**
   * Anchor point: center of objects/lights/text, origin of shapes (where a
   * floor's or pattern's texture is laid from; moves with the shape).
   */
  position: Vec2
  /** Degrees, clockwise on screen (a shape's: its texture's). */
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
  /**
   * Link id: entities sharing it are one shape drawn twice (a room's floor
   * and the wall around it, made together by Build). Moving, transforming
   * or editing the points of one changes the others the same way; each can
   * still be selected and deleted on its own.
   */
  link?: string
  /**
   * Locked: selected only on its own (a click on it, a rubber band that
   * caught nothing unlocked) and never changed until it's unlocked: the map
   * commands leave it as it is.
   */
  locked?: boolean
  /** Text content (Text tool). */
  text?: string
  /**
   * Entity this one is attached to (an extension's door on a wall, a torch
   * on a column): moving the parent moves it too.
   */
  parent?: string
  /**
   * Extensions' own data, by extension id. Kept as is when the extension
   * isn't installed (the map still opens; its data waits for it).
   */
  ext?: Record<string, Record<string, unknown>>
  params: Record<string, unknown>
}

/** A floor/level of the map. Only the active level is edited and drawn on top. */
export interface MapLevel {
  id: string
  /** User-given name; empty means "unnamed" (the UI shows a numbered label). */
  name: string
  /** Extensions' data on the level (see MapEntity.ext). */
  ext?: Record<string, Record<string, unknown>>
}

/**
 * The map's grid: square (the app's own) or one an extension draws (hex,
 * isometric…), and what distance a cell stands for (Measure).
 */
export interface MapGrid {
  kind: string
  cellDistance: number
  unit: string
}

export const DEFAULT_GRID: MapGrid = { kind: "square", cellDistance: 5, unit: "ft" }

/** An extension a map was made with (so opening it can offer to install it). */
export interface MapExtensionUse {
  id: string
  version: string
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

/**
 * Building wear: the grime multiplied over walls (and their ends), floors
 * and caves, set in Map Settings → Building Wear. "none" turns it off.
 */
export const BUILDING_WEARS = ["none", "dust", "grime", "noise", "scratched"] as const
export type BuildingWear = (typeof BUILDING_WEARS)[number]
/** The default for new maps. */
export const DEFAULT_BUILDING_WEAR: BuildingWear = "grime"

export const isBuildingWear = (v: unknown): v is BuildingWear =>
  typeof v === "string" && (BUILDING_WEARS as readonly string[]).includes(v)

export interface MapDocument {
  /** Dimensions in tiles. */
  width: number
  height: number
  entities: MapEntity[]
  levels: MapLevel[]
  environment: MapEnvironment
  buildingWear: BuildingWear
  /** Color adjustments over the whole map (Settings › Post-processing), saved with it. */
  postProcess: PostProcess
  referenceImage?: ReferenceImage | null
  /** Grid kind and scale (maps saved before it existed: the default). */
  grid?: MapGrid
  /** Extensions' map-wide data (see MapEntity.ext). */
  ext?: Record<string, Record<string, unknown>>
  /** Extensions whose data or entities the map holds. */
  extensions?: MapExtensionUse[]
}

export const DEFAULT_LEVEL_ID = "level-1"
export const DEFAULT_AMBIENT_LIGHT = "#ffffff"

export function createDocument(
  width: number,
  height: number,
  buildingWear: BuildingWear = DEFAULT_BUILDING_WEAR,
): MapDocument {
  return {
    buildingWear,
    postProcess: DEFAULT_POST_PROCESS,
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
    buildingWear: isBuildingWear(doc.buildingWear) ? doc.buildingWear : base.buildingWear,
    postProcess: normalizePostProcess(doc.postProcess),
    referenceImage: doc.referenceImage ?? null,
    entities: (doc.entities ?? []).map((e) => (e.level ? e : { ...e, level: fallbackLevel })),
  }
}

/** A saved post-process completed with the defaults (maps saved before it existed: none). */
function normalizePostProcess(saved: Partial<PostProcess> | undefined): PostProcess {
  const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback)
  const d = DEFAULT_POST_PROCESS
  return {
    brightness: num(saved?.brightness, d.brightness),
    contrast: num(saved?.contrast, d.contrast),
    saturation: num(saved?.saturation, d.saturation),
    threshold: num(saved?.threshold, d.threshold),
    filter: POST_FILTERS.find((f) => f === saved?.filter) ?? d.filter,
  }
}
