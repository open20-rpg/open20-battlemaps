import { type IconType } from "react-icons"
import {
  LuBox,
  LuBrickWall,
  LuBrush,
  LuDoorOpen,
  LuDroplets,
  LuGrid3X3,
  LuHouse,
  LuLightbulb,
  LuMountainSnow,
  LuPaintbrush,
  LuRoute,
  LuTriangle,
  LuType,
} from "react-icons/lu"
import { isSelectable } from "../map/model/geometry"
import { expandGroups } from "../map/model/groups"
import { type MapEntity } from "../map/model/types"

/**
 * Kinds of map elements, as data, for the Select tool: its element filter
 * (which kinds clicks and rubber bands can pick) and the "Select all …"
 * buttons it offers while nothing is selected.
 */
export interface SelectKind {
  id: string
  /** Name (the filter button's tooltip). */
  nameKey: string
  /** "Select all …" button label. */
  labelKey: string
  icon: IconType
  toolIds: readonly string[]
  /** Brush paint: selectable by its strokes, only when the filter allows it. */
  paint?: boolean
  /** Whether the element filter lets it be picked by default. */
  filterDefault: boolean
}

const kind = (
  id: string,
  icon: IconType,
  toolIds: readonly string[],
  filterDefault = true,
  paint = false,
): SelectKind => ({
  id,
  nameKey: `tools.kind_${id}`,
  labelKey: `tools.selectAll_${id}`,
  icon,
  toolIds,
  filterDefault,
  paint,
})

export const SELECT_KINDS: SelectKind[] = [
  kind("objects", LuBox, ["object", "scatter"]),
  kind("walls", LuBrickWall, ["wall"]),
  kind("portals", LuDoorOpen, ["portal"]),
  // Floors are big and under everything else: off by default.
  kind("floors", LuHouse, ["build"], false),
  kind("paths", LuRoute, ["path"]),
  kind("patterns", LuGrid3X3, ["pattern"]),
  kind("roofs", LuTriangle, ["roof"]),
  kind("water", LuDroplets, ["water"]),
  kind("lights", LuLightbulb, ["light"], false),
  kind("texts", LuType, ["text"]),
  kind("terrain", LuBrush, ["terrainBrush"], false, true),
  kind("caves", LuMountainSnow, ["cave"], true, true),
  kind("materials", LuPaintbrush, ["material"], true, true),
]

/** The element filter's default: the kinds pickable out of the box. */
export const SELECT_FILTER_DEFAULT = SELECT_KINDS.filter((k) => k.filterDefault).map((k) => k.id)

const KIND_OF_TOOL = new Map(SELECT_KINDS.flatMap((k) => k.toolIds.map((t) => [t, k] as const)))

/**
 * Whether the Select tool may pick `e` with the element filter `enabled`
 * (kind ids). Entities of no listed kind are always pickable. Locked
 * entities are skipped — or, with `locked`, are the only ones picked.
 */
export function selectableBy(
  enabled: readonly string[],
  locked = false,
): (e: MapEntity) => boolean {
  const on = new Set(enabled)
  return (e) => {
    if (!!e.locked !== locked) return false
    const k = KIND_OF_TOOL.get(e.toolId)
    if (!k) return isSelectable(e)
    return on.has(k.id) && isSelectable(e, k.paint === true)
  }
}

/** The element filter stored in the Select tool's params (its default if unset). */
export function elementFilter(params: Record<string, unknown>): string[] {
  const v = params.filter
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : SELECT_FILTER_DEFAULT
}

/** Ids of the selectable entities of `kind` (whole groups of those it picks). */
export function idsOfKind(kind: SelectKind, entities: readonly MapEntity[]): string[] {
  const tools = new Set(kind.toolIds)
  const picked = entities
    .filter((e) => tools.has(e.toolId) && isSelectable(e, kind.paint === true))
    .map((e) => e.id)
  return picked.length > 0 ? expandGroups(picked, entities) : []
}
