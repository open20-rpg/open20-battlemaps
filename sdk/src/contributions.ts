/**
 * What an extension can add to the app. Each contribution is registered at
 * runtime (`ctx.contribute` or the typed helpers on the context) and removed
 * when the extension is disabled. Functions inside become callbacks: the
 * host calls them across the sandbox and awaits their result, so they may
 * be async. They are never called per frame — results are cached by the
 * host and recomputed only when their inputs change.
 */
import { type LocalizedText } from "./manifest"
import {
  type AssetCategory,
  type AssetInfo,
  type AssetSearch,
  type DataDrivenStyle,
  type Entity,
  type EntityKind,
  type EntityMatch,
  type EntityStyle,
  type ExportRequest,
  type FileData,
  type ImportResult,
  type KeyEvent,
  type LightTypeSpec,
  type MapDocumentData,
  type MapOp,
  type NewEntity,
  type ParamSpec,
  type ParticleEmitter,
  type PointerEvent,
  type Primitive,
  type Rect,
  type ShaderSpec,
  type UiNode,
  type Vec2,
} from "./types"

type Awaitable<T> = T | Promise<T>

/** Where a tool goes in the palette: a core group or a group of the extension. */
export type ToolGroup = "design" | "terrain" | "objects" | "effects" | "settings" | `ext:${string}`

/** What a tool handler gets: the tool's params and where it is used. */
export interface ToolContext {
  toolId: string
  params: Record<string, unknown>
  level: string
  snap: boolean
}

/**
 * A gesture the host handles for the tool (the same controllers the core
 * tools use); the tool then only gets the finished shape in `onShape`.
 */
export type ToolGesture =
  "none" | "click" | "drag" | "polyline" | "polygon" | "rect" | "ellipse" | "brush"

export interface ShapeResult {
  gesture: ToolGesture
  points: Vec2[]
  /** For rect/ellipse: the box; for brush: the stroke radius. */
  rect?: Rect
  radius?: number
}

export interface ToolContribution {
  type: "tool"
  id: string
  name: LocalizedText
  /** SVG markup (sanitized by the host) or a core icon name. */
  icon: string
  group: ToolGroup
  params?: ParamSpec[]
  /** Opens the Library on the right filtered to this category. */
  library?: AssetCategory
  librarySelect?: "single" | "multi"
  gesture?: ToolGesture
  /** Keys the tool handles while active (they skip the global shortcuts). */
  keys?: string[]
  /** CSS cursor while active. */
  cursor?: string
  /** Help shown in the tool's panel (Markdown). */
  help?: LocalizedText
  /** Also receive pointer moves without a button pressed (hover). Off by default. */
  hover?: boolean
  onShape?: (ctx: ToolContext, shape: ShapeResult) => Awaitable<void>
  onPointerDown?: (ctx: ToolContext, e: PointerEvent) => Awaitable<void>
  onPointerMove?: (ctx: ToolContext, e: PointerEvent) => Awaitable<void>
  onPointerUp?: (ctx: ToolContext, e: PointerEvent) => Awaitable<void>
  onDoubleClick?: (ctx: ToolContext, e: PointerEvent) => Awaitable<void>
  onKey?: (ctx: ToolContext, e: KeyEvent) => Awaitable<void>
  onAction?: (ctx: ToolContext, action: string) => Awaitable<void>
  onActivate?: (ctx: ToolContext) => Awaitable<void>
  onDeactivate?: (ctx: ToolContext) => Awaitable<void>
  onParamsChange?: (ctx: ToolContext, patch: Record<string, unknown>) => Awaitable<void>
}

/** Where an entity property reads and writes its value. */
export type PropertyTarget =
  | { data: string }
  | { field: "rotation" | "scale" | "layer" | "color" | "asset" | "text" }
  | { param: string }

export interface PropertiesContribution {
  type: "properties"
  /** Kinds it applies to (core or the extension's own). */
  kinds: EntityKind[]
  properties: { spec: ParamSpec; target: PropertyTarget }[]
}

export interface SelectionModeContribution {
  type: "selectionMode"
  id: string
  name: LocalizedText
  /** Given the selection (maybe empty), the ids to select. */
  select: (selection: Entity[]) => Awaitable<string[]>
}

export interface BrushTipContribution {
  type: "brushTip"
  id: string
  name: LocalizedText
  /** Bundled image (alpha is the tip). */
  asset: string
  /** Size and opacity from pressure (0–1). */
  dynamics?: { size?: [number, number]; opacity?: [number, number] }
  /** 0..1: how much the stroke is smoothed. */
  smoothing?: number
}

export interface ScatterDistributionContribution {
  type: "scatterDistribution"
  id: string
  name: LocalizedText
  /** Points (tile coordinates) for one stamp of the Scatter tool in `area`. */
  points: (area: Rect, density: number, seed: number) => Awaitable<Vec2[]>
}

export interface WallStyleContribution {
  type: "wallStyle"
  id: string
  name: LocalizedText
  /** Drawn for each wall that uses it (instead of the core look). */
  render: (wall: Entity) => Awaitable<Primitive[]>
}

export interface PathStyleContribution {
  type: "pathStyle"
  id: string
  name: LocalizedText
  render: (path: Entity) => Awaitable<Primitive[]>
  /** Route a path between two points (e.g. around walls). */
  route?: (from: Vec2, to: Vec2) => Awaitable<Vec2[]>
}

export interface TerrainRuleContribution {
  type: "terrainRule"
  id: string
  name: LocalizedText
  /** Slot weights (0–1 each) for a point, from height/slope or anything else. */
  weights: (p: Vec2, slots: number) => Awaitable<number[]>
}

export interface WaterStyleContribution {
  type: "waterStyle"
  id: string
  name: LocalizedText
  /** An entity shader drawn over water areas (registered with render.shader). */
  shader: string
  uniforms?: Record<string, number | number[] | string | boolean>
}

/**
 * The extension's own kind of entity. Its look is a function of its data,
 * so editing the data redraws it (parametric entities): a staircase, a
 * bridge, a compass rose.
 */
export interface EntityTypeContribution {
  type: "entityType"
  /** Becomes the kind `ext:<extension id>/<id>`. */
  id: string
  name: LocalizedText
  layer: number
  render: (entity: Entity) => Awaitable<Primitive[]>
  /** Shape that selects it (defaults to the bounds of what it draws). */
  hitShape?: (entity: Entity) => Awaitable<Vec2[]>
  /** Draggable handles; dragging one calls `onHandle` with its new position. */
  handles?: (entity: Entity) => Awaitable<{ id: string; position: Vec2 }[]>
  onHandle?: (entity: Entity, handle: string, position: Vec2) => Awaitable<MapOp[]>
  /** Anchored to the map's frame (compass, scale bar, title) instead of a cell. */
  anchor?: "map" | "frame"
  blocksLight?: boolean
  castsShadow?: boolean
}

export interface GeneratorContribution {
  type: "generator"
  id: string
  name: LocalizedText
  /** Where it's offered. */
  scope: ("map" | "area" | "selection" | "newMap")[]
  params?: ParamSpec[]
  /** Entities shown as a preview while params change (optional). */
  preview?: (input: GeneratorInput) => Awaitable<NewEntity[]>
  generate: (input: GeneratorInput) => Awaitable<MapOp[]>
}

export interface GeneratorInput {
  params: Record<string, unknown>
  seed: number
  area: Rect | null
  selection: Entity[]
  level: string
  /** For "newMap": the size picked. */
  size?: { width: number; height: number }
}

export interface StyleRuleContribution {
  type: "styleRule"
  id: string
  match: EntityMatch
  style: DataDrivenStyle
  /** Higher priorities are applied last (win). */
  priority?: number
}

export interface StyleFunctionContribution {
  type: "styleFunction"
  id: string
  match: EntityMatch
  /** Recomputed only when the entity changes. */
  style: (entity: Entity) => Awaitable<EntityStyle | null>
}

export interface ShaderContribution extends ShaderSpec {
  type: "shader"
}

export interface LayerShaderContribution {
  type: "layerShader"
  id: string
  /** Map layer values it applies to (each one drawn through the shader). */
  layers: number[]
  shader: string
  uniforms?: Record<string, number | number[] | string | boolean>
}

export interface PostShaderContribution {
  type: "postShader"
  id: string
  shader: string
  uniforms?: Record<string, number | number[] | string | boolean>
  /** Order among other post shaders (lower first). */
  order?: number
}

export interface FillShaderContribution {
  type: "fillShader"
  id: string
  name: LocalizedText
  shader: string
  /** Offered by these painted tools as a material. */
  tools: ("material" | "pattern" | "terrainBrush" | "water" | "cave")[]
}

export interface LayerContribution {
  type: "layer"
  id: string
  name: LocalizedText
  /** Z value between core layers (e.g. 650: above walls, under roofs). */
  value: number
}

export interface LightTypeContribution extends LightTypeSpec {
  type: "lightType"
}

export interface ParticlesContribution {
  type: "particles"
  id: string
  name: LocalizedText
  emitters: ParticleEmitter[]
  /** Shown as a toggle in the view controls. */
  toggle?: boolean
}

export interface GridTypeContribution {
  type: "gridType"
  id: string
  name: LocalizedText
  /** Lines and shapes of the grid over `area` (cached per map size). */
  draw: (area: Rect) => Awaitable<Primitive[]>
  /** Snap a point to the grid. */
  snap: (p: Vec2) => Awaitable<Vec2>
  /** Distance in cells between two points (for Measure). */
  distance?: (a: Vec2, b: Vec2) => Awaitable<number>
  /** Label of the cell at a point (A1, 0204…). */
  label?: (p: Vec2) => Awaitable<string>
}

export interface SnapProviderContribution {
  type: "snapProvider"
  id: string
  name: LocalizedText
  /** Candidate points near `p` (the closest within reach wins). */
  points: (p: Vec2, reach: number) => Awaitable<Vec2[]>
}

export interface OverlayToggleContribution {
  type: "viewToggle"
  id: string
  name: LocalizedText
  icon: string
  default: boolean
  onChange: (on: boolean) => Awaitable<void>
}

export interface ImportFormatContribution {
  type: "importFormat"
  id: string
  name: LocalizedText
  extensions: string[]
  import: (file: FileData) => Awaitable<ImportResult>
}

export interface ExportFormatContribution {
  type: "exportFormat"
  id: string
  name: LocalizedText
  extension: string
  options?: ParamSpec[]
  export: (request: ExportRequest) => Awaitable<FileData>
}

export interface ExportProfileContribution {
  type: "exportProfile"
  id: string
  name: LocalizedText
  /** Entities hidden in this profile (DM notes, secret doors…). */
  hide: EntityMatch[]
}

export interface ExportHookContribution {
  type: "exportHook"
  id: string
  options?: ParamSpec[]
  /** Change the exported PNG (watermark, crop, scale). */
  process: (image: FileData, options: Record<string, unknown>) => Awaitable<FileData>
}

export interface DocumentHookContribution {
  type: "documentHook"
  id: string
  /** Warnings to show (never blocks saving). */
  beforeSave?: () => Awaitable<string[]>
  afterOpen?: () => Awaitable<string[]>
}

export interface FileHandlerContribution {
  type: "fileHandler"
  id: string
  /** File extensions (without dot) it opens or accepts when dropped. */
  extensions: string[]
  open?: (file: FileData) => Awaitable<ImportResult>
  drop?: (file: FileData, at: Vec2) => Awaitable<MapOp[]>
}

/** Turns the data of a Dungeondraft mod in an imported map into entities. */
export interface DungeondraftTranslatorContribution {
  type: "dungeondraftTranslator"
  id: string
  /** Mod ids or data keys it understands. */
  handles: string[]
  translate: (
    data: unknown,
    map: MapDocumentData,
  ) => Awaitable<{ entities: NewEntity[]; warnings: string[] }>
}

export interface CommandContribution {
  type: "command"
  id: string
  title: LocalizedText
  icon?: string
  /** Default key combo (`Ctrl+Shift+K`); the user can rebind it. */
  shortcut?: string
  /** Where it shows: the menu (under the Extensions menu), the palette. */
  menu?: "extensions" | "edit" | "view" | "map" | "file"
  palette?: boolean
  run: () => Awaitable<void>
}

export interface ContextMenuContribution {
  type: "contextMenu"
  id: string
  title: LocalizedText
  /** Shown over these entities (or on the empty canvas, `canvas: true`). */
  match?: EntityMatch
  canvas?: boolean
  run: (target: { entities: Entity[]; at: Vec2 }) => Awaitable<void>
}

export interface PanelContribution {
  type: "panel"
  id: string
  title: LocalizedText
  icon?: string
  /** Initial UI; update it with `ui.updatePanel`. */
  render: () => Awaitable<UiNode>
}

export interface IframePanelContribution {
  type: "iframePanel"
  id: string
  title: LocalizedText
  icon?: string
  /** HTML file in the extension. It talks to the extension with `ui.postToFrame`. */
  html: string
  onMessage?: (message: unknown) => Awaitable<void>
}

export interface StatusItemContribution {
  type: "statusItem"
  id: string
  text: string
  tooltip?: string
  onClick?: () => Awaitable<void>
}

export interface TourContribution {
  type: "tour"
  id: string
  title: LocalizedText
  steps: { target: TourTarget; text: LocalizedText }[]
}

/** UI parts a tour can point at. */
export type TourTarget =
  | "tools"
  | "toolPanel"
  | "library"
  | "canvas"
  | "menu"
  | "statusBar"
  | "viewControls"
  | `tool:${string}`
  | `panel:${string}`

export interface LibraryTabContribution {
  type: "libraryTab"
  id: string
  title: LocalizedText
  category?: AssetCategory
  search: (query: AssetSearch) => Awaitable<AssetInfo[]>
}

export interface StatsContribution {
  type: "stats"
  id: string
  title: LocalizedText
  compute: () => Awaitable<{ label: string; value: string }[]>
}

export interface AssetBehaviorContribution {
  type: "assetBehavior"
  id: string
  /** Assets (ids or tags) it reacts to. */
  match: { assets?: string[]; tags?: string[] }
  /** Ops to apply when one is placed (in the same undo step). */
  onPlaced: (entity: Entity) => Awaitable<MapOp[]>
}

export interface AssetMetadataContribution {
  type: "assetMetadata"
  id: string
  /** Fields shown in the pack editor for each asset. */
  fields: ParamSpec[]
}

export interface PlacementRuleContribution {
  type: "placementRule"
  id: string
  name: LocalizedText
  kinds: EntityKind[]
  /** Adjust an entity about to be placed (snap against walls, face them…). */
  adjust: (entity: NewEntity) => Awaitable<NewEntity>
}

export interface MapSizeContribution {
  type: "newMapPreset"
  id: string
  name: LocalizedText
  width: number
  height: number
  /** A generator run on the new map (its id in this extension). */
  generator?: string
}

export interface ServiceContribution {
  type: "service"
  /** Others reach it as `<extension id>/<id>`. */
  id: string
  version: string
  methods: Record<string, (...args: never[]) => Awaitable<unknown>>
}

export interface ViewContribution {
  type: "view"
  id: string
  title: LocalizedText
  /** Entities hidden in this view (DM-only things). */
  hide?: EntityMatch[]
  /** Fog of war: areas not revealed are covered. */
  fog?: boolean
}

export type Contribution =
  | ToolContribution
  | PropertiesContribution
  | SelectionModeContribution
  | BrushTipContribution
  | ScatterDistributionContribution
  | WallStyleContribution
  | PathStyleContribution
  | TerrainRuleContribution
  | WaterStyleContribution
  | EntityTypeContribution
  | GeneratorContribution
  | StyleRuleContribution
  | StyleFunctionContribution
  | ShaderContribution
  | LayerShaderContribution
  | PostShaderContribution
  | FillShaderContribution
  | LayerContribution
  | LightTypeContribution
  | ParticlesContribution
  | GridTypeContribution
  | SnapProviderContribution
  | OverlayToggleContribution
  | ImportFormatContribution
  | ExportFormatContribution
  | ExportProfileContribution
  | ExportHookContribution
  | DocumentHookContribution
  | FileHandlerContribution
  | DungeondraftTranslatorContribution
  | CommandContribution
  | ContextMenuContribution
  | PanelContribution
  | IframePanelContribution
  | StatusItemContribution
  | TourContribution
  | LibraryTabContribution
  | StatsContribution
  | AssetBehaviorContribution
  | AssetMetadataContribution
  | PlacementRuleContribution
  | MapSizeContribution
  | ServiceContribution
  | ViewContribution

export type ContributionType = Contribution["type"]

/** The permission each contribution type needs. */
export const CONTRIBUTION_PERMISSIONS: Record<ContributionType, string> = {
  tool: "tools",
  properties: "tools",
  selectionMode: "tools",
  brushTip: "tools",
  scatterDistribution: "tools",
  wallStyle: "tools",
  pathStyle: "tools",
  terrainRule: "tools",
  waterStyle: "tools",
  placementRule: "tools",
  assetBehavior: "tools",
  entityType: "render",
  generator: "generators",
  newMapPreset: "generators",
  styleRule: "render",
  styleFunction: "render",
  shader: "render:shaders",
  layerShader: "render:shaders",
  postShader: "render:shaders",
  fillShader: "render:shaders",
  layer: "render",
  lightType: "render",
  particles: "render",
  gridType: "render",
  snapProvider: "editor",
  viewToggle: "ui",
  importFormat: "files",
  exportFormat: "files",
  exportProfile: "files",
  exportHook: "files",
  documentHook: "map:read",
  fileHandler: "files",
  dungeondraftTranslator: "files",
  command: "ui",
  contextMenu: "ui",
  panel: "ui",
  iframePanel: "ui:iframe",
  statusItem: "ui",
  tour: "ui",
  libraryTab: "library:read",
  stats: "map:read",
  assetMetadata: "packs:write",
  service: "services",
  view: "views",
}

/** A contribution as it travels: functions replaced by callback references. */
export type Serialized<T> = T extends (...args: never[]) => unknown
  ? CallbackRef
  : T extends readonly (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T

export interface CallbackRef {
  $cb: number
}

export const isCallbackRef = (v: unknown): v is CallbackRef =>
  typeof v === "object" && v !== null && typeof (v as CallbackRef).$cb === "number"
