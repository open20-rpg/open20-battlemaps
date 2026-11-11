import polygonClipping, { type Ring } from "polygon-clipping"
import { type Vec2 } from "./types"

/** A polygon with holes: its outline and the rings cut out of it. */
export interface PolygonWithHoles {
  outer: Vec2[]
  holes: Vec2[][]
}

const toRing = (points: readonly Vec2[]): Ring => points.map((p) => [p.x, p.y])

/** A clipper ring as points, without the closing repeat of the first one. */
function fromRing(ring: Ring): Vec2[] {
  const pts = ring.map(([x, y]) => ({ x, y }))
  const [first] = pts
  const last = pts[pts.length - 1]
  if (pts.length > 1 && first.x === last.x && first.y === last.y) pts.pop()
  return pts
}

/** Twice the signed area (positive counter-clockwise in a y-up frame). */
function signedArea2(ring: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    a += p.x * q.y - q.x * p.y
  }
  return a
}

/**
 * `subject` minus `cut`: the pieces left (each maybe with holes), or null
 * when they don't overlap (nothing to change). An empty list means the cut
 * covers it all.
 */
export function subtractPolygon(
  subject: readonly Vec2[],
  cut: readonly Vec2[],
): PolygonWithHoles[] | null {
  const a = [toRing(subject)]
  const b = [toRing(cut)]
  if (polygonClipping.intersection(a, b).length === 0) return null
  return polygonClipping.difference(a, b).map(([outer, ...holes]) => ({
    outer: fromRing(outer),
    holes: holes.map(fromRing),
  }))
}

/** Whether segments ab and cd cross at a point inside both (touching ends don't count). */
function properlyCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = o(c, d, a)
  const d2 = o(c, d, b)
  const d3 = o(a, b, c)
  const d4 = o(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/**
 * One ring tracing `outer` and its holes, each hole joined to the outline
 * by a two-way "bridge" edge (a keyhole). It fills exactly the polygon with
 * holes, so floors and patterns — single rings in the model — can have them.
 */
export function bridgeHoles({ outer, holes }: PolygonWithHoles): Vec2[] {
  let ring = [...outer]
  const sign = Math.sign(signedArea2(outer))
  // Holes wind against the outline, so the keyhole ring stays simple.
  const pending = holes.map((h) => (Math.sign(signedArea2(h)) === sign ? [...h].reverse() : h))
  while (pending.length > 0) {
    const hole = pending.shift() ?? []
    const edges = (pts: readonly Vec2[]) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]])
    const obstacles = [...edges(ring), ...pending.flatMap(edges), ...edges(hole)]
    let best: { o: number; h: number; d: number } | null = null
    for (let h = 0; h < hole.length; h++) {
      for (let o = 0; o < ring.length; o++) {
        const d = Math.hypot(ring[o].x - hole[h].x, ring[o].y - hole[h].y)
        if (best && d >= best.d) continue
        const blocked = obstacles.some(([c, e]) => properlyCross(ring[o], hole[h], c, e))
        if (!blocked) best = { o, h, d }
      }
    }
    const { o, h } = best ?? { o: 0, h: 0 }
    const around = [...hole.slice(h), ...hole.slice(0, h), hole[h]]
    ring = [...ring.slice(0, o + 1), ...around, ring[o], ...ring.slice(o + 1)]
  }
  return ring
}
