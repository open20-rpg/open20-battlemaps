/**
 * The public, versioned shapes the extension API exchanges. They are a
 * stable view over the app's internal model (which may change between
 * versions): the host adapts between both, so extensions don't break when
 * the app's internals do.
 *
 * Every value here is plain data (structured-clone friendly). Functions in
 * a contribution are turned into callbacks by the runtime (see runtime.ts).
 */
import { type LocalizedText, type UniformSpec, type ShaderTarget } from "./manifest"

export interface Vec2 {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// -- map ----------------------------------------------------------------------

/** Kinds of the app's own entities; extension kinds are `ext:<extension id>/<type>`. */
export const CORE_ENTITY_KINDS = [
  "object",
  "scatter",
  "portal",
  "wall",
  "build",
  "path",
  "pattern",
  "roof",
  "light",
  "text",
  "cave",
  "terrainBrush",
  "water",
  "material",
] as const
export type CoreEntityKind = (typeof CORE_ENTITY_KINDS)[number]
export type EntityKind = CoreEntityKind | `ext:${string}`

export interface Entity {
  id: string
  kind: EntityKind
  level: string
  /** Z-order bucket (see MapSnapshot.layers). */
  layer: number
  position: Vec2
  rotation: number
  scale: number
  flipX: boolean
  flipY: boolean
  points?: Vec2[]
  closed?: boolean
  group?: string
  link?: string
  /** Entity it is attached to: it moves with it. */
  parent?: string
  locked: boolean
  text?: string
  /** Main asset (objects, scatter, portals) and its color, when it has one. */
  asset?: string
  color?: string
  /** This extension's own data on the entity (saved in the map). */
  data: Record<string, unknown>
  /** The app's raw params: read-only and NOT stable across versions. */
  params: Readonly<Record<string, unknown>>
}

/** An entity to create: what's left out takes the defaults of its kind. */
export interface NewEntity {
  kind: EntityKind
  level?: string
  layer?: number
  position: Vec2
  rotation?: number
  scale?: number
  flipX?: boolean
  flipY?: boolean
  points?: Vec2[]
  closed?: boolean
  text?: string
  asset?: string
  color?: string
  parent?: string
  data?: Record<string, unknown>
  /** Raw params for core kinds (unstable, see Entity.params). */
  params?: Record<string, unknown>
}

export type EntityPatch = Partial<
  Pick<
    Entity,
    | "layer"
    | "position"
    | "rotation"
    | "scale"
    | "flipX"
    | "flipY"
    | "points"
    | "closed"
    | "text"
    | "asset"
    | "color"
    | "level"
  >
> & { params?: Record<string, unknown> }

export interface Level {
  id: string
  name: string
  /** This extension's data on the level (elevation, kind…). */
  data: Record<string, unknown>
}

export type GridKind = "square" | `ext:${string}`

export interface GridSettings {
  kind: GridKind
  /** Distance one cell stands for, in `unit`. */
  cellDistance: number
  unit: string
}

export interface MapSnapshot {
  width: number
  height: number
  levels: Level[]
  ambientLight: string
  buildingWear: string
  postProcess: Readonly<Record<string, unknown>>
  grid: GridSettings
  /** Layers by value (bottom to top) with their names, including extension layers. */
  layers: { value: number; name: string }[]
  /** This extension's map-wide data. */
  data: Record<string, unknown>
  /** Extensions the map says it uses. */
  extensions: { id: string; version: string }[]
  entityCount: number
}

export interface EntityQuery {
  ids?: string[]
  level?: string | "active" | "all"
  kinds?: EntityKind[]
  /** Entities whose bounds touch this rect. */
  rect?: Rect
  /** Entities under this point. */
  point?: Vec2
  assets?: string[]
  /** Only those with this extension's data under the key. */
  hasData?: string
  group?: string
  limit?: number
}

export type ReorderMode = "front" | "back" | "forward" | "backward"

/**
 * One change to the map. A list of them is applied by `map.apply` as one
 * undoable step. Entities that are locked are left as they are (except to
 * unlock them).
 */
export type MapOp =
  | { op: "add"; entities: NewEntity[]; under?: boolean }
  | { op: "update"; id: string; patch: EntityPatch }
  | { op: "remove"; ids: string[] }
  | { op: "move"; ids: string[]; delta: Vec2 }
  | {
      op: "transform"
      ids: string[]
      pivot?: Vec2
      rotate?: number
      scale?: number
      flipX?: boolean
      flipY?: boolean
    }
  | { op: "replaceAsset"; from: string; to: string; ids?: string[] }
  | { op: "group"; ids: string[] }
  | { op: "ungroup"; ids: string[] }
  | { op: "link"; ids: string[] }
  | { op: "unlink"; ids: string[] }
  | { op: "lock"; ids: string[]; locked: boolean }
  | { op: "reorder"; ids: string[]; mode: ReorderMode }
  | { op: "attach"; ids: string[]; parent: string | null }
  | { op: "setData"; id: string; data: Record<string, unknown> | null }
  | { op: "setMapData"; data: Record<string, unknown> | null }
  | { op: "setLevelData"; id: string; data: Record<string, unknown> | null }
  | { op: "addLevel"; name: string; id?: string }
  | { op: "renameLevel"; id: string; name: string }
  | { op: "removeLevel"; id: string }
  | { op: "moveLevel"; id: string; dir: 1 | -1 }
  | { op: "setAmbientLight"; color: string }
  | { op: "setBuildingWear"; wear: string }
  | { op: "setPostProcess"; values: Record<string, unknown> }
  | { op: "resize"; width: number; height: number }
  | { op: "setGrid"; grid: Partial<GridSettings> }

export interface ApplyResult {
  /** Ids of the entities created by `add` ops, in order. */
  created: string[]
  /** Ops that did nothing (unknown or locked ids). */
  skipped: number
}

/** What changed in the map since the last event. */
export interface MapChange {
  added: string[]
  updated: string[]
  removed: string[]
  /** Something else changed (levels, settings, grid…). */
  settings: boolean
  /** The change came from undo/redo. */
  history: "undo" | "redo" | null
  /** Extension that made it (null: the user or the app). */
  source: string | null
}

// -- editor -------------------------------------------------------------------

export type ViewToggle = "grid" | "snap" | "lighting" | "shadows" | "outside" | "animations"

export interface EditorState {
  selection: string[]
  activeLevel: string | null
  activeTool: string | null
  zoom: number
  pan: Vec2
  view: Record<ViewToggle, boolean>
  /** Last pointer position over the map, in tiles. */
  pointer: Vec2 | null
}

export interface PointerEvent {
  x: number
  y: number
  /** Snapped to the grid (or the snap providers) when Snap is on. */
  snapped: Vec2
  button: number
  buttons: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  /** Pen pressure 0–1 (0.5 for mice), tilt in degrees, pointer type. */
  pressure: number
  tiltX: number
  tiltY: number
  pointerType: "mouse" | "pen" | "touch"
  /** Touches currently down (multitouch gestures). */
  touches: number
}

export interface KeyEvent {
  key: string
  code: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
}

export interface CameraTarget {
  center?: Vec2
  zoom?: number
  /** Frame these entities or this rect. */
  fit?: string[] | Rect
}

// -- params & ui --------------------------------------------------------------

/**
 * A control for a tool param, a property or a form field. It mirrors the
 * app's own param kinds that make sense outside the core tools.
 */
export type ParamSpec =
  | { kind: "switch"; key: string; label: LocalizedText; default: boolean; tooltip?: LocalizedText }
  | {
      kind: "slider"
      key: string
      label: LocalizedText
      default: number
      min: number
      max: number
      step: number
    }
  | {
      kind: "range"
      key: string
      label: LocalizedText
      default: [number, number]
      min: number
      max: number
      step: number
    }
  | {
      kind: "segmented"
      key: string
      label: LocalizedText
      default: string
      options: { value: string; label: LocalizedText; icon?: string }[]
    }
  | { kind: "color"; key: string; label: LocalizedText; default: string; presets?: string[] }
  | { kind: "text"; key: string; label: LocalizedText; default: string; maxLength?: number }
  | {
      kind: "number"
      key: string
      label: LocalizedText
      default: number
      min?: number
      max?: number
    }
  | { kind: "layer"; key: string; default: number; allowed?: number[] }
  | {
      kind: "asset"
      key: string
      label: LocalizedText
      default: string | null
      category: AssetCategory
    }
  | { kind: "font"; key: string; label: LocalizedText; default: { family: string; style: string } }
  | { kind: "button"; key: string; label: LocalizedText; icon?: string }

/** The Library's categories (the pack folders assets come from). */
export type AssetCategory =
  | "objects"
  | "portals"
  | "walls"
  | "tilesets"
  | "paths"
  | "terrain"
  | "materials"
  | "lights"
  | "roofs"
  | "caves"

/**
 * Declarative UI: a tree of these nodes, drawn by the app with its own
 * components (so it follows the theme, is accessible and adapts to phones).
 * Events go back to the extension through callbacks.
 */
export type UiNode =
  | { type: "column"; children: UiNode[]; gap?: number }
  | { type: "row"; children: UiNode[]; gap?: number }
  | { type: "text"; text: string; tone?: "normal" | "muted" | "danger"; size?: "sm" | "md" | "lg" }
  | { type: "heading"; text: string }
  | {
      type: "button"
      label: string
      icon?: string
      variant?: "solid" | "outline" | "ghost"
      disabled?: boolean
      onClick: () => void
    }
  | {
      type: "field"
      spec: ParamSpec
      value: unknown
      onChange: (value: unknown) => void
    }
  | {
      type: "list"
      items: { id: string; label: string; detail?: string; icon?: string }[]
      selected?: string
      onSelect?: (id: string) => void
    }
  | { type: "image"; src: string; alt: string; width?: number }
  | { type: "progress"; value: number | null }
  | { type: "divider" }
  | { type: "markdown"; text: string }

/** A short message to the user. */
export interface Notification {
  message: string
  tone?: "info" | "success" | "warning" | "error"
  /** Buttons; the call resolves with the one clicked (or null if dismissed). */
  actions?: { id: string; label: string }[]
}

// -- library ------------------------------------------------------------------

export interface PackInfo {
  id: string
  name: string
  author: string
  version: string
  editable: boolean
  enabled: boolean
}

export interface AssetInfo {
  /** Library id (`{packId}|{path}`, or `ext:<extension>/<name>` for runtime assets). */
  id: string
  name: string
  category: AssetCategory | string
  pack: string
  tags: string[]
  /** Size in tiles, when known. */
  size?: { w: number; h: number }
  colorable: boolean
  /** Small image URL usable in the extension's UI. */
  thumbnail?: string
}

export interface AssetSearch {
  query?: string
  category?: AssetCategory
  tags?: string[]
  packs?: string[]
  limit?: number
}

// -- render -------------------------------------------------------------------

export type BlendMode = "normal" | "add" | "multiply" | "screen" | "overlay" | "darken" | "lighten"

/** Effects that need no GLSL: each one is a filter the app already ships. */
export type BuiltinFilter =
  | { type: "blur"; strength: number }
  | { type: "glow"; color: string; strength: number }
  | { type: "pixelate"; size: number }
  | { type: "noise"; amount: number }
  | { type: "grayscale" }
  | { type: "sepia" }
  | { type: "vignette"; amount: number }
  | { type: "outline"; color: string; width: number }

/**
 * How one entity is drawn, over its normal look. Nothing here changes the
 * map: remove the rule (or the extension) and the entity looks as before.
 */
export interface EntityStyle {
  /** Multiplied over the texture (`#rrggbb`). */
  tint?: string
  alpha?: number
  blend?: BlendMode
  /** -180..180, 0..2, 0..2, 0..2 (1 = unchanged). */
  hue?: number
  saturation?: number
  brightness?: number
  contrast?: number
  /** Visual offset in tiles and extra scale. */
  offset?: Vec2
  scale?: number
  filters?: BuiltinFilter[]
  /** A registered entity shader, with its uniform values. */
  shader?: { id: string; uniforms?: Record<string, number | number[] | string | boolean> }
  hidden?: boolean
}

/** Which entities a style rule applies to (all the given fields must match). */
export interface EntityMatch {
  kinds?: EntityKind[]
  assets?: string[]
  /** Assets with any of these tags. */
  tags?: string[]
  packs?: string[]
  levels?: string[]
  /** This extension's data: the key exists (or equals `equals`). */
  data?: { key: string; equals?: unknown }
}

/**
 * A style read from the entity's data: e.g. `{ tint: { data: "color" } }`
 * tints each entity with its own `data.color`. Evaluated by the host, so
 * rules cost nothing per frame.
 */
export type StyleValue<T> = T | { data: string; default?: T }
export type DataDrivenStyle = { [K in keyof EntityStyle]?: StyleValue<EntityStyle[K]> }

/**
 * Something to draw, in map tiles. Lists of these draw the extension's own
 * entities, overlays, frame elements and grids; the host turns them into
 * the engine's objects (extensions never touch the GPU directly).
 */
export type Primitive =
  | {
      type: "path"
      points: Vec2[]
      closed?: boolean
      fill?: string
      fillAlpha?: number
      stroke?: string
      strokeWidth?: number
      strokeAlpha?: number
      dash?: number[]
      /** Texture the fill repeats (an asset id), at `textureScale` tiles. */
      texture?: string
      textureScale?: number
    }
  | {
      type: "circle"
      center: Vec2
      radius: number
      fill?: string
      fillAlpha?: number
      stroke?: string
      strokeWidth?: number
    }
  | {
      type: "sprite"
      asset: string
      position: Vec2
      rotation?: number
      /** Width in tiles (height keeps the aspect ratio unless given). */
      width?: number
      height?: number
      tint?: string
      alpha?: number
    }
  | {
      type: "text"
      text: string
      position: Vec2
      size: number
      color?: string
      font?: string
      align?: "left" | "center" | "right"
      rotation?: number
    }
  | {
      type: "mesh"
      vertices: Vec2[]
      /** Texture coordinates (0–1), one per vertex. */
      uvs: Vec2[]
      indices: number[]
      texture: string
      tint?: string
    }
  | { type: "group"; children: Primitive[]; alpha?: number; style?: EntityStyle }

export interface ShaderSpec {
  id: string
  name: LocalizedText
  target: ShaderTarget
  /** GLSL ES 3.0 fragment shader body (the host adds the header and standard uniforms). */
  fragment: string
  uniforms?: Record<string, UniformSpec>
  /** Uses `uTime`: drawn continuously while Animations is on. */
  animated?: boolean
}

export interface ParticleEmitter {
  /** Where particles are born: the whole map, an area or a point. */
  area: "map" | Rect | Vec2
  /** Particles per second (capped by the host). */
  rate: number
  lifetime: [number, number]
  speed: [number, number]
  /** Degrees; 0 = towards +x on screen. */
  direction: [number, number]
  size: [number, number]
  color: string | string[]
  alpha?: [number, number]
  gravity?: Vec2
  /** Asset id of the particle image (a soft dot when absent). */
  asset?: string
  blend?: BlendMode
  level?: string
}

/** A light's falloff and behavior (the Light tool lists them). */
export interface LightTypeSpec {
  id: string
  name: LocalizedText
  /** Falloff from the center (0) to the edge (1): returns 0..1. */
  falloff: "linear" | "smooth" | "sharp" | number[]
  /** Cone angle in degrees (360: all around). */
  cone?: number
  /** Flicker amount 0..1 (needs Animations on). */
  flicker?: number
}

// -- files --------------------------------------------------------------------

export interface FileData {
  name: string
  bytes: Uint8Array
  mime?: string
}

export interface ImportResult {
  map: MapDocumentData
  /** What couldn't be carried over, shown to the user. */
  warnings: string[]
}

/** A whole map as plain data (the stable view, used by import/export/templates). */
export interface MapDocumentData {
  width: number
  height: number
  levels: { id: string; name: string }[]
  entities: NewEntity[]
  ambientLight?: string
  grid?: Partial<GridSettings>
  data?: Record<string, unknown>
}

export interface ExportRequest {
  /** Export profile picked (null: everything visible). */
  profile: string | null
  options: Record<string, unknown>
}

// -- analysis -----------------------------------------------------------------

export interface Room {
  id: string
  polygon: Vec2[]
  area: number
  level: string
  /** Entities (portals) connecting it with other rooms. */
  doors: { portal: string; to: string | null }[]
}

export interface Walkability {
  width: number
  height: number
  /** Cells per tile. */
  resolution: number
  /** 1 = walkable, row by row. */
  cells: Uint8Array
}
