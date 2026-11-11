import { type IconType } from "react-icons"
import {
  LuBox,
  LuBrickWall,
  LuDoorOpen,
  LuDroplets,
  LuGrid3X3,
  LuHouse,
  LuLightbulb,
  LuRoute,
  LuTriangle,
  LuType,
} from "react-icons/lu"
import { isSelectable } from "../map/model/geometry"
import { expandGroups } from "../map/model/groups"
import { type MapEntity } from "../map/model/types"

/**
 * "Select all …" shortcuts the Select tool offers while nothing is selected,
 * as data: each picks every selectable entity of some tools on the level.
 */
export interface SelectKind {
  id: string
  labelKey: string
  icon: IconType
  toolIds: readonly string[]
}

export const SELECT_KINDS: SelectKind[] = [
  { id: "objects", labelKey: "tools.selectObjects", icon: LuBox, toolIds: ["object", "scatter"] },
  { id: "walls", labelKey: "tools.selectWalls", icon: LuBrickWall, toolIds: ["wall"] },
  { id: "portals", labelKey: "tools.selectPortals", icon: LuDoorOpen, toolIds: ["portal"] },
  { id: "floors", labelKey: "tools.selectFloors", icon: LuHouse, toolIds: ["build"] },
  { id: "paths", labelKey: "tools.selectPaths", icon: LuRoute, toolIds: ["path"] },
  { id: "patterns", labelKey: "tools.selectPatterns", icon: LuGrid3X3, toolIds: ["pattern"] },
  { id: "roofs", labelKey: "tools.selectRoofs", icon: LuTriangle, toolIds: ["roof"] },
  { id: "water", labelKey: "tools.selectWater", icon: LuDroplets, toolIds: ["water"] },
  { id: "lights", labelKey: "tools.selectLights", icon: LuLightbulb, toolIds: ["light"] },
  { id: "texts", labelKey: "tools.selectTexts", icon: LuType, toolIds: ["text"] },
]

/** Ids of the selectable entities of `kind` (whole groups of those it picks). */
export function idsOfKind(kind: SelectKind, entities: readonly MapEntity[]): string[] {
  const tools = new Set(kind.toolIds)
  const picked = entities.filter((e) => tools.has(e.toolId) && isSelectable(e)).map((e) => e.id)
  return picked.length > 0 ? expandGroups(picked, entities) : []
}
