import { type ToolParamValues } from "../params"

/** Pointer event info in map coordinates (tiles), viewport-agnostic. */
export interface PointerInfo {
  /** Position in tile coordinates. */
  x: number
  y: number
  buttons: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
}

/**
 * Everything a behavior may act on. `params` is the tool's resolved param bag
 * (defaults materialized); document mutations go through the commands module
 * (import from features/map/commands inside the behavior).
 */
export interface ToolCtx {
  toolId: string
  params: ToolParamValues
}

/**
 * The behavior half of a tool: what it does to the map. The data half (name,
 * icon, params UI) lives in definitions.ts; both are looked up by tool id.
 * Handlers are optional — a tool with no behavior yet simply does nothing on
 * the canvas.
 */
export interface ToolBehavior {
  onPointerDown?(ctx: ToolCtx, e: PointerInfo): void
  onPointerMove?(ctx: ToolCtx, e: PointerInfo): void
  onPointerUp?(ctx: ToolCtx, e: PointerInfo): void
  /** CSS cursor for the viewport while this tool is active. */
  cursor?(params: ToolParamValues): string
}
