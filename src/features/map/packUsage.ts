import { useMapStore } from "../../stores/mapStore"
import { useToolsStore } from "../../stores/toolsStore"
import { TOOL_BY_ID } from "../tools/definitions"
import type { AssetSelection, BiomeSelection, ToolParamValues } from "../tools/params"
import { removeEntities } from "./commands"

/** The packId prefix of a library item id ("{packId}|{relPath}"). */
function packIdOf(assetId: string): string {
  const i = assetId.indexOf("|")
  return i === -1 ? assetId : assetId.slice(0, i)
}

/** Pack ids referenced by one tool's param bag (only assetPicker/biome params hold asset ids). */
function packIdsInParams(toolId: string, values: ToolParamValues): Set<string> {
  const ids = new Set<string>()
  for (const spec of TOOL_BY_ID.get(toolId)?.params ?? []) {
    const value = values[spec.paramKey]
    if (spec.kind === "assetPicker") {
      for (const id of (value as AssetSelection | undefined)?.assets ?? []) ids.add(packIdOf(id))
    } else if (spec.kind === "biome") {
      for (const slots of Object.values(
        (value as BiomeSelection | undefined)?.slotsByBiome ?? {},
      )) {
        for (const tex of slots) if (tex) ids.add(packIdOf(tex.id))
      }
    }
  }
  return ids
}

/**
 * Pack ids referenced anywhere in the currently open map: placed entities
 * plus the live (not-yet-placed) tool params. Used to decide whether a pack
 * can be freely deactivated or would break something the user has set up.
 */
export function getUsedPackIds(): Set<string> {
  const used = new Set<string>()
  const map = useMapStore.getState().map
  for (const entity of map?.entities ?? []) {
    for (const id of packIdsInParams(entity.toolId, entity.params)) used.add(id)
  }
  for (const [toolId, values] of Object.entries(useToolsStore.getState().paramsByTool)) {
    for (const id of packIdsInParams(toolId, values)) used.add(id)
  }
  return used
}

/** Whether `packId` is referenced anywhere in the currently open map. */
export function isPackUsed(packId: string): boolean {
  return getUsedPackIds().has(packId)
}

/**
 * Strip every reference to `packId` from the open map: placed entities that
 * depend on it are deleted (through the normal map command, so it's still
 * undoable), and any live tool param referencing it is cleared back to "no
 * asset". Call this only after the user confirmed the pack's content may be
 * lost — the tool-param reset itself is NOT tracked by undo/redo.
 */
export function clearPackReferences(packId: string): void {
  const map = useMapStore.getState().map
  if (map) {
    const staleIds = map.entities
      .filter((e) => packIdsInParams(e.toolId, e.params).has(packId))
      .map((e) => e.id)
    if (staleIds.length > 0) removeEntities(staleIds)
  }

  const { paramsByTool, setToolParams } = useToolsStore.getState()
  for (const [toolId, values] of Object.entries(paramsByTool)) {
    if (!packIdsInParams(toolId, values).has(packId)) continue

    const patch: ToolParamValues = {}
    for (const spec of TOOL_BY_ID.get(toolId)?.params ?? []) {
      const value = values[spec.paramKey]
      if (spec.kind === "assetPicker") {
        const sel = value as AssetSelection | undefined
        if (sel?.assets.some((id) => packIdOf(id) === packId)) {
          patch[spec.paramKey] = {
            ...sel,
            assets: sel.assets.filter((id) => packIdOf(id) !== packId),
          }
        }
      } else if (spec.kind === "biome") {
        const biome = value as BiomeSelection | undefined
        if (biome) {
          const slotsByBiome: BiomeSelection["slotsByBiome"] = {}
          let touched = false
          for (const [name, slots] of Object.entries(biome.slotsByBiome)) {
            const next = slots.map((tex) => (tex && packIdOf(tex.id) === packId ? null : tex))
            if (next.some((tex, i) => tex !== slots[i])) touched = true
            slotsByBiome[name] = next
          }
          if (touched) patch[spec.paramKey] = { ...biome, slotsByBiome }
        }
      }
    }
    if (Object.keys(patch).length > 0) setToolParams(toolId, patch)
  }
}
