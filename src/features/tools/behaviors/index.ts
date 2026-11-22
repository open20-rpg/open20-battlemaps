import { createMeasureBehavior } from "./measure"
import { buildToolCtx } from "./context"
import { createLightBehavior, environmentBehavior, mapSettingsBehavior } from "./effects"
import { createScatterBehavior, objectBehavior } from "./objects"
import {
  createCaveBehavior,
  createMaterialBehavior,
  createTerrainBehavior,
  createWaterBehavior,
} from "./paint"
import { createSelectBehavior } from "./select"
import {
  createPrefabsBehavior,
  createReferenceImageBehavior,
  createPostProcessingBehavior,
  createShadowSettingsBehavior,
} from "./settings"
import {
  createBuildBehavior,
  createPathBehavior,
  createPatternBehavior,
  createRoofBehavior,
  createWallBehavior,
  portalBehavior,
} from "./structures"
import { createTextBehavior } from "./text"
import { createReplaceAssetsBehavior } from "./replaceAssets"
import { type ToolBehavior } from "./types"
import { type ToolParamValues } from "../params"
import { type DraftShape } from "../../../stores/editorStore"

export type { PointerInfo, ToolBehavior, ToolCtx } from "./types"

/**
 * Behavior registry, keyed by tool id (the same ids as TOOL_TREE). Adding a
 * tool to the editor means: (1) its data entry in definitions.ts, (2) its
 * behavior here, (3) its i18n keys. The viewport dispatches pointer/keyboard
 * events to the active tool's behavior via {@link getToolBehavior}.
 *
 * Map Settings and Level Settings have no canvas interaction: their panels
 * act directly (grid params are read by the canvas; levels are edited by
 * the Levels control).
 */
export const TOOL_BEHAVIORS: Record<string, ToolBehavior> = {
  build: createBuildBehavior(),
  wall: createWallBehavior(),
  portal: portalBehavior,
  cave: createCaveBehavior(),
  pattern: createPatternBehavior(),
  roof: createRoofBehavior(),
  terrainBrush: createTerrainBehavior(),
  water: createWaterBehavior(),
  material: createMaterialBehavior(),
  path: createPathBehavior(),
  object: objectBehavior,
  scatter: createScatterBehavior(),
  environment: environmentBehavior,
  mapSettings: mapSettingsBehavior,
  light: createLightBehavior(),
  referenceImage: createReferenceImageBehavior(),
  shadowSettings: createShadowSettingsBehavior(),
  postProcessing: createPostProcessingBehavior(),
  text: createTextBehavior(),
  prefabs: createPrefabsBehavior(),
  measure: createMeasureBehavior(),
  select: createSelectBehavior(),
  replaceAssets: createReplaceAssetsBehavior(),
}

/** Behaviors of extensions' tools (features/extensions/tools.ts keeps them in sync). */
const extraBehaviors = new Map<string, ToolBehavior>()

export function setExtraBehaviors(behaviors: ReadonlyMap<string, ToolBehavior>): void {
  extraBehaviors.clear()
  for (const [id, b] of behaviors) extraBehaviors.set(id, b)
}

export function getToolBehavior(toolId: string): ToolBehavior | undefined {
  return TOOL_BEHAVIORS[toolId] ?? extraBehaviors.get(toolId)
}

/** What the tool draws over the map right now (its `overlay`), or nothing. */
export function toolOverlay(toolId: string): DraftShape[] {
  const overlay = getToolBehavior(toolId)?.overlay
  const ctx = overlay && buildToolCtx(toolId)
  return ctx ? overlay(ctx) : []
}

/** Run a tool's command button (e.g. Text's Delete, Terrain's Fill). */
export function runToolAction(toolId: string, action: string): void {
  const ctx = buildToolCtx(toolId)
  if (ctx) getToolBehavior(toolId)?.onAction?.(ctx, action)
}

/** Whether a tool's command button is currently disabled. */
export function isToolActionDisabled(toolId: string, action: string): boolean {
  const ctx = buildToolCtx(toolId)
  return !ctx || (getToolBehavior(toolId)?.isActionDisabled?.(ctx, action) ?? false)
}

/** Notify a tool that its params changed in the panel (after they're stored). */
export function notifyParamsChange(toolId: string, patch: ToolParamValues): void {
  const ctx = buildToolCtx(toolId)
  if (ctx) getToolBehavior(toolId)?.onParamsChange?.(ctx, patch)
}
