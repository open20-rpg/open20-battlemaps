import { useSyncExternalStore } from "react"
import { useMapStore } from "../../stores/mapStore"
import { findMissingAssets } from "../map/missingAssets"
import { type MapDocument } from "../map/model/types"
import { assetCache } from "../map/render/assets"

/**
 * Problems in the open map a tool exists to fix. A tool node declaring one
 * (`alert` in TOOL_TREE) only shows while there's something to fix, and
 * stands out with how many.
 */
export type ToolAlertId = "missingAssets"

const NO_ENTITIES: MapDocument["entities"] = []

/** Distinct assets the map uses but can't draw (Replace Assets). */
function useMissingAssetCount(enabled: boolean): number {
  const entities = useMapStore((s) => (enabled ? (s.map?.entities ?? NO_ENTITIES) : NO_ENTITIES))
  const missing = useSyncExternalStore(assetCache.subscribe, assetCache.missingIds)
  if (!enabled || missing.size === 0) return 0
  return findMissingAssets(entities, (id) => missing.has(id)).length
}

/** How many things `alert` has to fix right now (0 without an alert). */
export function useToolAlert(alert: ToolAlertId | undefined): number {
  // One hook per alert id, always called: the set of alerts is fixed.
  return useMissingAssetCount(alert === "missingAssets")
}
