import { type Vec2 } from "../model/types"

/**
 * Roof geometry, as Dungeondraft's Roof.Set builds it from a ridge line and
 * a width (map space, tiles; y down):
 *  - slopes: per ridge segment A→B, a quad on each side, from the ridge to
 *    the eave line offset `width` away (mitered at the ridge's bends);
 *  - "hip": the ridge is shortened by `width` at each end, where a tip
 *    triangle [left corner, ridge end, right corner] closes the roof, its
 *    two hip lines running corner → ridge end → corner;
 *  - "dormer": the same at the far end only; its start stays open (it meets
 *    another roof there) and so does its edge line;
 *  - "gable": the ridge as drawn, open gable ends.
 * Each slope carries its outward normal (downhill): what its tiles are
 * turned by and what the sun shades it by.
 */

export type RoofType = "gable" | "hip" | "dormer"

export interface RoofFace {
  points: Vec2[]
  /** Unit normal pointing downhill (away from the ridge). */
  normal: Vec2
}

export interface RoofGeometry {
  slopes: RoofFace[]
  tips: RoofFace[]
  /** The ridge line as drawn (shortened at hip ends). */
  ridge: Vec2[]
  /** The eave outline, around the whole roof. */
  edge: Vec2[]
  edgeClosed: boolean
  hips: Vec2[][]
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y) || 1
  return { x: v.x / l, y: v.y / l }
}

/** Where (a + t·da) meets (b + s·db); null when parallel. */
function intersect(a: Vec2, da: Vec2, b: Vec2, db: Vec2): Vec2 | null {
  const den = da.x * db.y - da.y * db.x
  if (Math.abs(den) < 1e-12) return null
  const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / den
  return add(a, scale(da, t))
}

/**
 * The ridge offset `dist` along `side` of each segment's normal (`side`
 * picks it from the segment direction), mitered at the bends.
 */
function offsetLine(
  pts: readonly Vec2[],
  dirs: readonly Vec2[],
  normal: (d: Vec2) => Vec2,
  dist: number,
): Vec2[] {
  return pts.map((p, i) => {
    const before = dirs[i - 1]
    const after = dirs[i]
    if (!before) return add(p, scale(normal(after), dist))
    if (!after) return add(p, scale(normal(before), dist))
    const a = add(p, scale(normal(before), dist))
    const b = add(p, scale(normal(after), dist))
    return intersect(a, before, b, after) ?? a
  })
}

/** Left of a direction (y down): (d.y, −d.x), as Dungeondraft's nL. */
const leftOf = (d: Vec2): Vec2 => ({ x: d.y, y: -d.x })
const rightOf = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x })

export function roofGeometry(
  points: readonly Vec2[],
  width: number,
  type: RoofType,
): RoofGeometry | null {
  const pts = points.filter(
    (p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-9,
  )
  if (pts.length < 2 || width <= 0) return null
  const dirs = pts.slice(1).map((p, i) => unit(sub(p, pts[i])))
  const left = offsetLine(pts, dirs, leftOf, width)
  const right = offsetLine(pts, dirs, rightOf, width)
  const n = pts.length

  // The ridge as drawn: hip ends pulled in by `width` (never past the middle
  // of a one-segment ridge).
  const ridge = pts.map((p) => ({ ...p }))
  const firstLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
  const lastLen = Math.hypot(pts[n - 1].x - pts[n - 2].x, pts[n - 1].y - pts[n - 2].y)
  const hipStart = type === "hip"
  const hipEnd = type === "hip" || type === "dormer"
  const cut = (len: number, both: boolean) => Math.min(width, both && n === 2 ? len / 2 : len)
  if (hipStart) ridge[0] = add(pts[0], scale(dirs[0], cut(firstLen, hipEnd)))
  if (hipEnd) ridge[n - 1] = sub(pts[n - 1], scale(dirs[n - 2], cut(lastLen, hipStart)))

  const slopes: RoofFace[] = []
  for (let i = 0; i < n - 1; i++) {
    const d = dirs[i]
    slopes.push(
      { points: [ridge[i], ridge[i + 1], left[i + 1], left[i]], normal: leftOf(d) },
      { points: [ridge[i], ridge[i + 1], right[i + 1], right[i]], normal: rightOf(d) },
    )
  }
  const tips: RoofFace[] = []
  const hips: Vec2[][] = []
  if (hipStart) {
    tips.push({ points: [left[0], ridge[0], right[0]], normal: scale(dirs[0], -1) })
    hips.push([left[0], ridge[0], right[0]])
  }
  if (hipEnd) {
    tips.push({ points: [left[n - 1], ridge[n - 1], right[n - 1]], normal: dirs[n - 2] })
    hips.push([left[n - 1], ridge[n - 1], right[n - 1]])
  }
  // Around the eaves: down the left side, back up the right. A dormer's
  // outline starts at its first point and stays open there.
  const edge = [...left, ...[...right].reverse()]
  return { slopes, tips, ridge, edge, edgeClosed: type !== "dormer", hips }
}

/** A roof from a dragged box (Quickbox): its ridge runs down the middle of the longer side. */
export function quickboxRoof(a: Vec2, b: Vec2): { ridge: Vec2[]; width: number } {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  const w = x1 - x0
  const h = y1 - y0
  if (w >= h) {
    const cy = (y0 + y1) / 2
    return {
      ridge: [
        { x: x0, y: cy },
        { x: x1, y: cy },
      ],
      width: h / 2,
    }
  }
  const cx = (x0 + x1) / 2
  return {
    ridge: [
      { x: cx, y: y0 },
      { x: cx, y: y1 },
    ],
    width: w / 2,
  }
}

/**
 * A face's sun shade (gray level): ((sun·n + 1) / 2 − 1)·contrast + 1, the
 * sun at `sunDeg` (map space, y down). 1 facing the sun, 1 − contrast away.
 */
export function roofFaceShade(normal: Vec2, sunDeg: number, contrast: number): number {
  const t = (sunDeg * Math.PI) / 180
  const dot = Math.cos(t) * normal.x + Math.sin(t) * normal.y
  return ((dot + 1) / 2 - 1) * contrast + 1
}

/**
 * Texture coordinates (texture-px units divided by the texture's size) of a
 * slope vertex, as Godot's Polygon2D lays them out: the vertex in world px
 * turned by atan2(n.x, n.y), so tile rows run along the ridge and fall
 * toward each eave.
 */
export function slopeUv(
  v: Vec2,
  normal: Vec2,
  pxPerTile: number,
  texW: number,
  texH: number,
): Vec2 {
  const rot = Math.atan2(normal.x, normal.y)
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const x = v.x * pxPerTile
  const y = v.y * pxPerTile
  return { x: (x * c - y * s) / texW, y: (x * s + y * c) / texH }
}
