import {
  entityAssetId,
  spriteCorners,
  spriteFromUV,
  wallPieces,
  type AssetSizeOf,
  type WallOpening,
} from "./geometry"
import { type MapEntity, type Vec2 } from "./types"

/**
 * What stops light, for lights that cast shadows (their Shadow switch):
 * walls (their line, with gaps where an open portal sits), portals that
 * block light (closed doors) and objects that do (their silhouette: the
 * opaque part of their image, its rectangle until that is known). A
 * light then reaches only what it can see: its visibility polygon.
 */

export interface Segment {
  a: Vec2
  b: Vec2
}

const blocksLight = (e: MapEntity) => e.params.blockLight === true

/** The entities that can stop light (what a shadowed light depends on). */
export function lightBlockers(entities: readonly MapEntity[]): MapEntity[] {
  return entities.filter(
    (e) =>
      e.toolId === "wall" ||
      e.toolId === "portal" ||
      ((e.toolId === "object" || e.toolId === "scatter") && blocksLight(e)),
  )
}

const outline = (pts: readonly Vec2[]): Segment[] =>
  pts.map((a, i) => ({ a, b: pts[(i + 1) % pts.length] }))

/** An asset's silhouette outlines in fractions of its image (alphaOutline), once loaded. */
export type AssetOutlineOf = (assetId: string) => readonly (readonly Vec2[])[] | undefined

/** The segments that stop light among `entities`, in map tiles. */
export function blockingSegments(
  entities: readonly MapEntity[],
  sizeOf: AssetSizeOf,
  outlineOf?: AssetOutlineOf,
): Segment[] {
  // Open portals leave a gap in their wall that light goes through.
  const openings: WallOpening[] = entities
    .filter((e) => e.toolId === "portal" && !blocksLight(e))
    .map((p) => {
      const asset = typeof p.params.asset === "string" ? p.params.asset : undefined
      return { center: p.position, width: ((asset && sizeOf(asset)?.w) || 1) * (p.scale ?? 1) }
    })
  const out: Segment[] = []
  for (const e of entities) {
    if (e.toolId === "wall" && e.points && e.points.length > 1) {
      for (const p of wallPieces(e.points, !!e.closed, openings)) out.push({ a: p.a, b: p.b })
    } else if (e.toolId !== "wall" && blocksLight(e)) {
      const id = entityAssetId(e)
      const size = id ? sizeOf(id) : undefined
      const loops = id && size ? outlineOf?.(id) : undefined
      if (loops && size) {
        for (const loop of loops) out.push(...outline(loop.map((uv) => spriteFromUV(e, uv, size))))
      } else out.push(...outline(spriteCorners(e, sizeOf)))
    }
  }
  return out
}

/** Distance along the ray origin + t·dir to segment s, or Infinity when it misses. */
function rayHit(origin: Vec2, dir: Vec2, s: Segment): number {
  const ex = s.b.x - s.a.x
  const ey = s.b.y - s.a.y
  const den = dir.x * ey - dir.y * ex
  if (Math.abs(den) < 1e-12) return Infinity
  const ox = s.a.x - origin.x
  const oy = s.a.y - origin.y
  const t = (ox * ey - oy * ex) / den
  const u = (ox * dir.y - oy * dir.x) / den
  return t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity
}

/** Shortest distance from p to segment s. */
function distToSegment(p: Vec2, s: Segment): number {
  const ex = s.b.x - s.a.x
  const ey = s.b.y - s.a.y
  const len2 = ex * ex + ey * ey
  const t =
    len2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.a.x) * ex + (p.y - s.a.y) * ey) / len2)) : 0
  return Math.hypot(p.x - (s.a.x + t * ex), p.y - (s.a.y + t * ey))
}

/** The segments within `radius` of `origin`: all a light there can be blocked by. */
export function segmentsNear(
  origin: Vec2,
  radius: number,
  segments: readonly Segment[],
): Segment[] {
  const r = radius * 1.05
  return segments.filter((s) => distToSegment(origin, s) < r)
}

const polygons = new Map<string, { key: string; poly: Vec2[] }>()

/**
 * {@link visibilityPolygon} for light `id`, kept until the light moves or
 * changes range or what's within its reach changes: dragging anything else
 * (or anything out of its reach) doesn't recompute it.
 */
export function lightPolygon(
  id: string,
  origin: Vec2,
  radius: number,
  segments: readonly Segment[],
): Vec2[] {
  const near = segmentsNear(origin, radius, segments)
  const key = [
    origin.x,
    origin.y,
    radius,
    ...near.flatMap((s) => [s.a.x, s.a.y, s.b.x, s.b.y]),
  ].join(",")
  const cached = polygons.get(id)
  if (cached?.key === key) return cached.poly
  const poly = visibilityPolygon(origin, radius, near)
  polygons.set(id, { key, poly })
  return poly
}

/**
 * What a light at `origin` reaches within `radius`: the polygon swept by
 * rays cast toward every segment end (and just past it, to slip by
 * corners), each stopped by the nearest segment — bounded by a square a
 * little larger than the light.
 */
export function visibilityPolygon(
  origin: Vec2,
  radius: number,
  segments: readonly Segment[],
): Vec2[] {
  const r = radius * 1.05
  const near = segmentsNear(origin, radius, segments)
  const box: Vec2[] = [
    { x: origin.x - r, y: origin.y - r },
    { x: origin.x + r, y: origin.y - r },
    { x: origin.x + r, y: origin.y + r },
    { x: origin.x - r, y: origin.y + r },
  ]
  const all = [...near, ...outline(box)]
  const angles: number[] = []
  for (const s of all) {
    for (const p of [s.a, s.b]) {
      const a = Math.atan2(p.y - origin.y, p.x - origin.x)
      angles.push(a - 1e-5, a, a + 1e-5)
    }
  }
  const hits = angles.map((angle) => {
    const dir = { x: Math.cos(angle), y: Math.sin(angle) }
    let t = Infinity
    for (const s of all) t = Math.min(t, rayHit(origin, dir, s))
    return { angle, p: { x: origin.x + dir.x * t, y: origin.y + dir.y * t } }
  })
  return hits
    .filter((h) => Number.isFinite(h.p.x))
    .sort((a, b) => a.angle - b.angle)
    .map((h) => h.p)
}
