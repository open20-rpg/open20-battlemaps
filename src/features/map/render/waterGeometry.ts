import polygonClipping, { type MultiPolygon, type Ring } from "polygon-clipping"
import { type MapEntity, type Vec2 } from "../model/types"
import { cellsToMap, gridField, stampStroke, strokeGrid } from "./cells"
import { caveJitter, holeLoops, isoContours } from "./fields"

/**
 * Water as Dungeondraft keeps it (WaterMesh): polygons with holes, never a
 * raster. Shapes (rectangle, ellipse, polygon) enter exactly; a brush
 * stroke paints the 64 px cell grid with Dungeondraft's stamps and is
 * outlined by marching squares cut at half edges, every vertex jittered (as
 * caves are) — straight, slightly irregular edges. Each one is added to
 * (or, Alt-drawn, cut from) the water in document order.
 */

/** A polygon with its holes, in map tiles. */
export interface WaterPolygon {
  outer: Vec2[]
  holes: Vec2[][]
}

const toRing = (pts: readonly Vec2[]): Ring => pts.map((p) => [p.x, p.y])
const fromRing = (ring: Ring): Vec2[] => {
  const pts = ring.map(([x, y]) => ({ x, y }))
  const [a] = pts
  const z = pts[pts.length - 1]
  if (pts.length > 1 && a.x === z.x && a.y === z.y) pts.pop()
  return pts
}

/** Closed loops (outlines and holes, any order) as one multipolygon. */
function loopsToMulti(loops: Vec2[][]): MultiPolygon {
  const holes = holeLoops(loops)
  const outers = loops.filter((_, i) => !holes[i])
  const inside = (p: Vec2, poly: readonly Vec2[]) => {
    let hit = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]
      const b = poly[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
        hit = !hit
    }
    return hit
  }
  return outers.map((outer) => [
    toRing(outer),
    ...loops.filter((l, i) => holes[i] && inside(l[0], outer)).map(toRing),
  ])
}

/** The area one water entity adds (or cuts). */
function shapeOf(e: MapEntity): MultiPolygon {
  if (e.closed && e.points && e.points.length > 2) return [[toRing(e.points)]]
  const out: MultiPolygon = []
  for (const s of e.strokes ?? []) {
    if (s.points.length === 0) continue
    const grid = strokeGrid(s)
    stampStroke(grid, s, 1)
    const loops = isoContours(gridField(grid), grid.w, grid.h, 0.5).map((loop) =>
      loop.map((p) => cellsToMap(grid, p, caveJitter)),
    )
    out.push(...loopsToMulti(loops))
  }
  return out
}

const cuts = (e: MapEntity) =>
  e.params.erase === true || (e.strokes ?? []).some((s) => s.erase === true)

/** The water of `entities` (in document order) as polygons with holes. */
export function waterPolygons(entities: readonly MapEntity[]): WaterPolygon[] {
  let acc: MultiPolygon = []
  for (const e of entities) {
    const shape = shapeOf(e)
    if (shape.length === 0) continue
    acc = cuts(e)
      ? acc.length > 0
        ? polygonClipping.difference(acc, shape)
        : acc
      : polygonClipping.union(acc, shape)
  }
  return acc.map(([outer, ...holes]) => ({ outer: fromRing(outer), holes: holes.map(fromRing) }))
}

/**
 * Dungeondraft's ellipse sides for a w × h ellipse (tiles): max(24, (w+h)/64
 * px); under 32, n/2 + 16; then rounded to a multiple of 4 (×0.24).
 */
export function ellipseSides(w: number, h: number): number {
  let n = Math.max(24, ((w + h) * 256) / 64)
  if (n < 32) n = n / 2 + 16
  return Math.max(4, Math.round(n * 0.24) * 4)
}
