import { useEditorStore } from "../../../stores/editorStore"
import { useMapStore } from "../../../stores/mapStore"
import { getToolParams } from "../../../stores/toolsStore"
import { useViewStore } from "../../../stores/viewStore"
import { snapPoint } from "../../map/model/geometry"
import { type Vec2 } from "../../map/model/types"
import { assetCache } from "../../map/render/assets"
import { libraryAssetsOf } from "../params"
import { type ToolCtx } from "./types"

/**
 * Snapping that extensions provide (their grid kinds, their snap points):
 * a point near where they last snapped, or null to snap to the square grid.
 */
let snapOverride: ((p: Vec2) => Vec2 | null) | null = null

export function setSnapOverride(fn: ((p: Vec2) => Vec2 | null) | null): void {
  snapOverride = fn
}

/** Snapshot the stores into a behavior context for `toolId` (null without a map). */
export function buildToolCtx(toolId: string): ToolCtx | null {
  const map = useMapStore.getState().map
  if (!map) return null
  const { activeLevel } = useEditorStore.getState()
  const level = activeLevel ?? map.levels[0].id
  const snapEnabled = useViewStore.getState().snap
  const params = getToolParams(toolId)
  return {
    toolId,
    params,
    map,
    level,
    snapEnabled,
    snap: (p, step = 1) => (snapEnabled ? (snapOverride?.(p) ?? snapPoint(p, step)) : p),
    sizeOf: (id) => assetCache.size(id),
    alphaAt: (id, u, v) => assetCache.alphaAt(id, u, v),
    libraryAssets: libraryAssetsOf(params),
    entities: map.entities.filter((e) => !e.level || e.level === level),
  }
}
