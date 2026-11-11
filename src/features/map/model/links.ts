import { dist, newId } from "./geometry"
import { type MapEntity, type Vec2 } from "./types"

/**
 * Linked entities (see MapEntity.link): a room's floor and its wall, one
 * shape drawn twice. Whatever moves or reshapes one applies to its partners.
 */

/** `ids` plus every entity linked to one of them. */
export function withLinked(ids: readonly string[], entities: readonly MapEntity[]): string[] {
  const pick = new Set(ids)
  const links = new Set(entities.flatMap((e) => (pick.has(e.id) && e.link ? [e.link] : [])))
  if (links.size === 0) return [...ids]
  for (const e of entities) if (e.link && links.has(e.link)) pick.add(e.id)
  return [...pick]
}

/** The entities linked to `entity` (not itself). */
export function partnersOf(entity: MapEntity, entities: readonly MapEntity[]): MapEntity[] {
  return entity.link
    ? entities.filter((e) => e.id !== entity.id && e.link === entity.link && e.points)
    : []
}

/**
 * Move vertex `index` of `entity` to `to` (or remove it, with null), and
 * the vertex at the same place in each linked entity along with it.
 */
export function vertexPatches(
  entity: MapEntity,
  index: number,
  to: Vec2 | null,
  entities: readonly MapEntity[],
): Map<string, Partial<MapEntity>> {
  const patches = new Map<string, Partial<MapEntity>>()
  const from = entity.points?.[index]
  if (!from) return patches
  const edit = (e: MapEntity, i: number) => {
    const points = e.points ?? []
    patches.set(e.id, {
      points: to ? points.map((p, k) => (k === i ? to : p)) : points.filter((_, k) => k !== i),
    })
  }
  edit(entity, index)
  for (const partner of partnersOf(entity, entities)) {
    const i = partner.points?.findIndex((p) => dist(p, from) < 1e-6) ?? -1
    if (i >= 0) edit(partner, i)
  }
  return patches
}

/** Whether two outlines have the same vertices (any start, either direction). */
export function sameOutline(a: readonly Vec2[], b: readonly Vec2[], tol = 1e-3): boolean {
  return a.length === b.length && a.every((p) => b.some((q) => dist(p, q) < tol))
}

/**
 * Link each floor (Build) to the closed wall on its level that traces the
 * same outline, when neither is linked yet (rooms from files that don't
 * record the link, e.g. Dungeondraft maps).
 */
export function linkRooms(entities: readonly MapEntity[]): MapEntity[] {
  const links = new Map<string, string>()
  const taken = new Set<string>()
  for (const floor of entities) {
    if (floor.toolId !== "build" || !floor.closed || floor.link || !floor.points) continue
    const wall = entities.find(
      (w) =>
        w.toolId === "wall" &&
        w.closed &&
        !w.link &&
        !taken.has(w.id) &&
        w.level === floor.level &&
        sameOutline(w.points ?? [], floor.points ?? []),
    )
    if (!wall) continue
    const link = newId()
    links.set(floor.id, link)
    links.set(wall.id, link)
    taken.add(wall.id)
  }
  if (links.size === 0) return [...entities]
  return entities.map((e) => (links.has(e.id) ? { ...e, link: links.get(e.id) } : e))
}
