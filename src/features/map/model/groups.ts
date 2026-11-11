import { newId } from "./geometry"
import { type MapEntity } from "./types"

/** `ids` plus every entity sharing a group with one of them (groups select as a whole). */
export function expandGroups(ids: readonly string[], entities: readonly MapEntity[]): string[] {
  const pick = new Set(ids)
  const groups = new Set(entities.flatMap((e) => (pick.has(e.id) && e.group ? [e.group] : [])))
  if (groups.size === 0) return [...ids]
  for (const e of entities) if (e.group && groups.has(e.group)) pick.add(e.id)
  return [...pick]
}

/**
 * Copies keep their groups and links among themselves but must not join
 * the originals': give every group and link in `entities` a fresh id.
 */
export function regroup(entities: readonly MapEntity[]): MapEntity[] {
  const fresh = new Map<string, string>()
  const renew = (id: string | undefined) => {
    if (!id) return undefined
    if (!fresh.has(id)) fresh.set(id, newId())
    return fresh.get(id)
  }
  return entities.map((e) =>
    e.group || e.link ? { ...e, group: renew(e.group), link: renew(e.link) } : e,
  )
}

/** Whether any of `entities` belongs to a group. */
export const hasGroups = (entities: readonly MapEntity[]): boolean =>
  entities.some((e) => !!e.group)
