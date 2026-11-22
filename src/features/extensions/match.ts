import { type EntityMatch } from "@open20/battlemaps-sdk"
import { type MapEntity } from "../map/model/types"

/** Whether an entity matches a rule's filter (tags need the Library: not matched here). */
export function matches(entity: MapEntity, match: EntityMatch, extId: string): boolean {
  if (match.kinds && !match.kinds.includes(entity.toolId as never)) return false
  const asset = typeof entity.params.asset === "string" ? entity.params.asset : undefined
  if (match.assets && !(asset && match.assets.includes(asset))) return false
  if (match.packs && !(asset && match.packs.includes(asset.split("|")[0]))) return false
  if (match.tags) return false
  if (match.levels && !match.levels.includes(entity.level ?? "")) return false
  if (match.data) {
    const data = entity.ext?.[extId]
    if (!data || !(match.data.key in data)) return false
    if (match.data.equals !== undefined && data[match.data.key] !== match.data.equals) return false
  }
  return true
}
