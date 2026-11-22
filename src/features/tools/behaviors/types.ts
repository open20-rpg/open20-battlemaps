import { type DraftShape } from "../../../stores/editorStore"
import { type AssetSizeOf } from "../../map/model/geometry"
import { type MapDocument, type MapEntity, type Vec2 } from "../../map/model/types"
import { type ToolParamValues } from "../params"

/** Pointer event info in map coordinates (tiles), viewport-agnostic. */
export interface PointerInfo {
  /** Position in tile coordinates (unsnapped). */
  x: number
  y: number
  /** Which button started the gesture: 0 left, 2 right. */
  button: number
  buttons: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  /** Pen/touch input: pressure 0–1, tilt in degrees, and the kind of pointer. */
  pressure?: number
  tiltX?: number
  tiltY?: number
  pointerType?: string
}

/** A wheel notch over the map: `dir` +1 up (away from the user), −1 down. */
export interface WheelInfo extends PointerInfo {
  dir: 1 | -1
  /** A sideways scroll (trackpad / tilt wheel) instead of a vertical one. */
  horizontal: boolean
}

/**
 * Everything a behavior may read. `params` is the tool's resolved param bag
 * (defaults materialized); document mutations go through the commands module
 * (import from features/map/commands inside the behavior), transient state
 * (drafts, selection) through the editor store.
 */
export interface ToolCtx {
  toolId: string
  params: ToolParamValues
  /** The open document (never null while a behavior runs). */
  map: MapDocument
  /** Level new entities go on. */
  level: string
  /** Whether the Snap view toggle is on. */
  snapEnabled: boolean
  /** Snap a point to multiples of `step` tiles (default 1) when snapping is on. */
  snap: (p: Vec2, step?: number) => Vec2
  /** Asset sizes in tiles (for footprints/hit-testing). */
  sizeOf: AssetSizeOf
  /** Alpha (0–255) of an asset's texture at (u, v) in 0..1; undefined until it's loaded. */
  alphaAt: (assetId: string, u: number, v: number) => number | undefined
  /** Ids picked in the Library panel for this tool (Object, Scatter, Path). */
  libraryAssets: string[]
  /** Entities on the active level. */
  entities: MapEntity[]
}

/**
 * The behavior half of a tool: what it does to the map. The data half (name,
 * icon, params UI) lives in definitions.ts; both are looked up by tool id.
 * Every handler is optional.
 */
export interface ToolBehavior {
  onPointerDown?(ctx: ToolCtx, e: PointerInfo): void
  /** Called on every move, while dragging (`e.buttons` set) and while hovering. */
  onPointerMove?(ctx: ToolCtx, e: PointerInfo): void
  onPointerUp?(ctx: ToolCtx, e: PointerInfo): void
  onDoubleClick?(ctx: ToolCtx, e: PointerInfo): void
  /** Return true when the key was handled (stops the global shortcuts). */
  onKeyDown?(ctx: ToolCtx, e: KeyboardEvent): boolean
  /**
   * Mouse wheel without Ctrl (Ctrl+wheel always zooms). Return true when
   * handled; otherwise it resizes the tool's brush, if it has one.
   */
  onWheel?(ctx: ToolCtx, e: WheelInfo): boolean
  /** A command button param of this tool was pressed (keyed by its paramKey). */
  onAction?(ctx: ToolCtx, action: string): void
  /** The tool was just selected (e.g. load document state into its params). */
  onActivate?(ctx: ToolCtx): void
  /** The tool is being switched away from: finish or drop drafts. */
  onDeactivate?(ctx: ToolCtx): void
  /** One of this tool's params was changed in its panel (`patch` holds the change). */
  onParamsChange?(ctx: ToolCtx, patch: ToolParamValues): void
  /** Whether a command button param should be disabled right now. */
  isActionDisabled?(ctx: ToolCtx, action: string): boolean
  /**
   * Shapes drawn over the map while the tool is active, derived from the
   * document and the tool's params on every redraw (so undo, level changes
   * and assets loading keep them current). For drafts the tool builds up
   * itself, use the editor store's `draft` instead.
   */
  overlay?(ctx: ToolCtx): DraftShape[]
  /** CSS cursor for the viewport while this tool is active. */
  cursor?(params: ToolParamValues): string
  /**
   * Whether a long press on touch acts as a right-click (e.g. removing a
   * point). Off unless asked: for painting tools holding still is painting.
   */
  longPressRightClick?(ctx: ToolCtx): boolean
}
