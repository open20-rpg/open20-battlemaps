import { type Room, type Walkability } from "@open20/battlemaps-sdk"
import { distToPolyline, segmentsOf } from "../map/model/geometry"
import { type MapEntity, type Vec2 } from "../map/model/types"

/**
 * Map analysis the host offers extensions (`ctx.analysis`): rooms, where
 * one can walk, paths and line of sight. Pure functions over the entities
 * of one level, so they're cheap to test and never touch the stores.
 */

const WALL_REACH = 0.3
const PORTAL_REACH = 0.6

function polygonArea(poly: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a / 2)
}

const wallSegments = (entities: readonly MapEntity[]): [Vec2, Vec2][] =>
  entities
    .filter((e) => e.toolId === "wall" && e.points && e.points.length > 1)
    .flatMap((e) => segmentsOf(e.points!, e.closed))

const portalsOf = (entities: readonly MapEntity[]) => entities.filter((e) => e.toolId === "portal")

/** Rooms: closed floors (Build), with the portals on their outline as doors. */
export function findRooms(entities: readonly MapEntity[], level: string): Room[] {
  const floors = entities.filter(
    (e) => e.toolId === "build" && e.closed && e.points && e.points.length >= 3,
  )
  const portals = portalsOf(entities)
  const rooms = floors.map((f) => ({
    id: f.id,
    polygon: f.points!.map((p) => ({ ...p })),
    area: polygonArea(f.points!),
    level,
    doors: [] as Room["doors"],
  }))
  for (const portal of portals) {
    const touching = rooms.filter(
      (r) => distToPolyline(portal.position, r.polygon, true) <= PORTAL_REACH,
    )
    for (const r of touching) {
      const other = touching.find((o) => o !== r)
      r.doors.push({ portal: portal.id, to: other?.id ?? null })
    }
  }
  return rooms
}

/** Cells one can walk on: inside the map, away from walls (portals open them). */
export function walkability(
  entities: readonly MapEntity[],
  width: number,
  height: number,
  resolution = 2,
): Walkability {
  const res = Math.max(1, Math.min(4, Math.round(resolution)))
  const w = width * res
  const h = height * res
  const cells = new Uint8Array(w * h).fill(1)
  const segments = wallSegments(entities)
  const portals = portalsOf(entities).map((p) => p.position)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = { x: (x + 0.5) / res, y: (y + 0.5) / res }
      const nearWall = segments.some(([a, b]) => distToPolyline(p, [a, b]) < WALL_REACH)
      if (!nearWall) continue
      const door = portals.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < PORTAL_REACH)
      if (!door) cells[y * w + x] = 0
    }
  return { width: w, height: h, resolution: res, cells }
}

/** A* over the walkable cells (8 directions); null when there's no way. */
export function findPath(grid: Walkability, from: Vec2, to: Vec2): Vec2[] | null {
  const { width: w, height: h, resolution: res, cells } = grid
  const cell = (p: Vec2) => ({
    x: Math.max(0, Math.min(w - 1, Math.floor(p.x * res))),
    y: Math.max(0, Math.min(h - 1, Math.floor(p.y * res))),
  })
  const s = cell(from)
  const g = cell(to)
  const start = s.y * w + s.x
  const goal = g.y * w + g.x
  if (!cells[start] || !cells[goal]) return null
  const cost = new Float64Array(w * h).fill(Infinity)
  const came = new Int32Array(w * h).fill(-1)
  const heuristic = (i: number) => Math.hypot((i % w) - g.x, Math.floor(i / w) - g.y)
  const open: { i: number; f: number }[] = [{ i: start, f: heuristic(start) }]
  cost[start] = 0
  while (open.length) {
    let best = 0
    for (let k = 1; k < open.length; k++) if (open[k].f < open[best].f) best = k
    const { i } = open.splice(best, 1)[0]
    if (i === goal) break
    const cx = i % w
    const cy = Math.floor(i / w)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const n = ny * w + nx
        if (!cells[n]) continue
        // No corner cutting through walls.
        if (dx && dy && (!cells[cy * w + nx] || !cells[ny * w + cx])) continue
        const c = cost[i] + (dx && dy ? Math.SQRT2 : 1)
        if (c < cost[n]) {
          cost[n] = c
          came[n] = i
          open.push({ i: n, f: c + heuristic(n) })
        }
      }
  }
  if (start !== goal && came[goal] < 0) return null
  const out: Vec2[] = []
  for (let i = goal; i >= 0; i = i === start ? -1 : came[i])
    out.push({ x: ((i % w) + 0.5) / res, y: (Math.floor(i / w) + 0.5) / res })
  return out.reverse()
}

function raySegment(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const ex = b.x - a.x
  const ey = b.y - a.y
  const den = d.x * ey - d.y * ex
  if (Math.abs(den) < 1e-12) return null
  const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den
  const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den
  return t >= 0 && u >= 0 && u <= 1 ? t : null
}

/** What can be seen from `from` up to `radius`: a polygon cut by walls (portals see through). */
export function visibility(
  entities: readonly MapEntity[],
  from: Vec2,
  radius: number,
  rays = 180,
): Vec2[] {
  const portals = portalsOf(entities).map((p) => p.position)
  const segments = wallSegments(entities).filter(
    ([a, b]) => !portals.some((q) => distToPolyline(q, [a, b]) < PORTAL_REACH / 2),
  )
  const out: Vec2[] = []
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2
    const d = { x: Math.cos(ang), y: Math.sin(ang) }
    let t = radius
    for (const [a, b] of segments) {
      const hit = raySegment(from, d, a, b)
      if (hit !== null && hit < t) t = hit
    }
    out.push({ x: from.x + d.x * t, y: from.y + d.y * t })
  }
  return out
}
