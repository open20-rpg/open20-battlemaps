import { type Vec2 } from "../model/types"

/**
 * Mesh geometry for walls and paths, built the way Dungeondraft builds
 * them (walls: its modified Godot 3.4 Line2D; paths: its own "super build"
 * mesh), so textures land on the same pixels.
 *
 * Everything is in map space. `u` is the distance along the line in tiles
 * (divide by the texture's repeat length: its width at the line's scale);
 * `v` runs across, 0 on the left side (+normal) and 1 on the right.
 */

export interface LineVertex {
  x: number
  y: number
  u: number
  v: number
}

/** One triangle, with the opacity it should be drawn at (path fades). */
export interface LineTriangle {
  a: LineVertex
  b: LineVertex
  c: LineVertex
  alpha: number
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
const len = (v: Vec2) => Math.hypot(v.x, v.y)
const unit = (v: Vec2): Vec2 => {
  const l = len(v) || 1
  return { x: v.x / l, y: v.y / l }
}
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y
/** Left normal (rotate 90°). */
const normal = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x })
const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** Consecutive duplicates dropped (they have no direction). */
function distinct(points: readonly Vec2[]): Vec2[] {
  return points.filter((p, i) => i === 0 || len(sub(p, points[i - 1])) > 1e-9)
}

/**
 * A closed line opened where Dungeondraft opens it: at the midpoint of the
 * closing segment, inserted at both ends (the two ends meet flush there).
 */
export function openLoop(points: readonly Vec2[]): Vec2[] {
  const pts = distinct(points)
  if (pts.length > 2 && len(sub(pts[0], pts[pts.length - 1])) < 1e-9) pts.pop()
  if (pts.length < 2) return pts
  const m = mid(pts[pts.length - 1], pts[0])
  return [m, ...pts, m]
}

/** Where the lines (a + t·da) and (b + s·db) cross; null when parallel. */
function intersect(a: Vec2, da: Vec2, b: Vec2, db: Vec2): Vec2 | null {
  const den = da.x * db.y - da.y * db.x
  if (Math.abs(den) < 1e-12) return null
  const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / den
  return add(a, scale(da, t))
}

/** A cross-section of the line: its left (v = 0) and right (v = 1) points at `u`. */
interface Section {
  left: Vec2
  right: Vec2
  u: number
}

const section = (center: Vec2, nrm: Vec2, hw: number, u: number): Section => ({
  left: add(center, scale(nrm, hw)),
  right: add(center, scale(nrm, -hw)),
  u,
})

/** The two triangles joining two sections. */
function quad(a: Section, b: Section, out: LineTriangle[]): void {
  const v = (p: Vec2, u: number, side: number): LineVertex => ({ x: p.x, y: p.y, u, v: side })
  out.push(
    { a: v(a.left, a.u, 0), b: v(a.right, a.u, 1), c: v(b.left, b.u, 0), alpha: 1 },
    { a: v(a.right, a.u, 1), b: v(b.right, b.u, 1), c: v(b.left, b.u, 0), alpha: 1 },
  )
}

/** How far (in half-widths) a sharp corner's tip may reach before it's beveled instead. */
const SHARP_LIMIT = 2

export interface WallLineOptions {
  /** Bevel the corners (Dungeondraft's default) instead of mitering them. */
  bevel: boolean
  /**
   * Dungeondraft's normalize_uv (on for walls): at a corner reached by a
   * segment longer than the wall is wide, the texture wraps around the
   * corner over ±half-width of u instead of one stretched column.
   */
  normalizeUv: boolean
}

/**
 * Triangles of a wall of `width` along `points` (a closed wall is opened at
 * its closing segment's midpoint). Each corner's inner side meets at the
 * intersection of the two inner edges; the outer side is beveled (each
 * segment ends square at p ± normal·hw, the bevel joining them) or mitered
 * (falling back to a bevel past {@link SHARP_LIMIT} half-widths).
 */
export function wallTriangles(
  points: readonly Vec2[],
  closed: boolean,
  width: number,
  opts: WallLineOptions,
): LineTriangle[] {
  const pts = closed ? openLoop(points) : distinct(points)
  if (pts.length < 2 || width <= 0) return []
  const hw = width / 2
  const dirs = pts.slice(1).map((p, i) => unit(sub(p, pts[i])))
  const lens = pts.slice(1).map((p, i) => len(sub(p, pts[i])))
  const out: LineTriangle[] = []
  let u = 0
  let current = section(pts[0], normal(dirs[0]), hw, 0)
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const f0 = dirs[i - 1]
    const f1 = dirs[i]
    const n0 = normal(f0)
    const n1 = normal(f1)
    u += lens[i - 1]
    const cross = f0.x * f1.y - f0.y * f1.x
    if (Math.abs(cross) < 1e-9) continue
    // The side the line turns toward is the inner one (+1: the left side).
    const s = dot(n0, f1) > 0 ? 1 : -1
    const inner =
      intersect(add(p, scale(n0, s * hw)), f0, add(p, scale(n1, s * hw)), f1) ??
      add(p, scale(n0, s * hw))
    const o0 = add(p, scale(n0, -s * hw))
    const o1 = add(p, scale(n1, -s * hw))
    const tip = opts.bevel ? null : intersect(o0, f0, o1, f1)
    const miter = tip && len(sub(tip, p)) <= SHARP_LIMIT * hw ? tip : null
    /** A corner section with its inner point and an outer one. */
    const at = (outer: Vec2, uu: number): Section =>
      s === 1 ? { left: inner, right: outer, u: uu } : { left: outer, right: inner, u: uu }
    if (opts.normalizeUv && lens[i - 1] > width) {
      const before = section(sub(p, scale(f0, hw)), n0, hw, u - hw)
      const after = section(add(p, scale(f1, hw)), n1, hw, u + hw)
      quad(current, before, out)
      if (miter) {
        const corner = at(miter, u)
        quad(before, corner, out)
        quad(corner, after, out)
      } else {
        const k0 = at(o0, u - hw / 2)
        const k1 = at(o1, u + hw / 2)
        quad(before, k0, out)
        quad(k0, k1, out)
        quad(k1, after, out)
      }
      // The straight part after the corner starts at u + hw, hw along it:
      // u keeps counting the distance to the points.
      current = after
      continue
    }
    if (miter) {
      const corner = at(miter, u)
      quad(current, corner, out)
      current = corner
      continue
    }
    // Standard bevel: the corner is one triangle on a single texture column.
    const k0 = at(o0, u)
    const k1 = at(o1, u)
    quad(current, k0, out)
    const vtx = (q: Vec2, side: number): LineVertex => ({ x: q.x, y: q.y, u, v: side })
    const innerV = s === 1 ? 0 : 1
    out.push({ a: vtx(inner, innerV), b: vtx(o0, 1 - innerV), c: vtx(o1, 1 - innerV), alpha: 1 })
    current = k1
  }
  u += lens[lens.length - 1]
  quad(current, section(pts[pts.length - 1], normal(dirs[dirs.length - 1]), hw, u), out)
  return out
}

// -- paths --------------------------------------------------------------------

/** Dungeondraft's ease(x, −2): ease in-out, 0 → 0, 1 → 1. */
export function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x)
}

/**
 * A path's control points smoothed the way Dungeondraft does: Chaikin
 * corner cutting at c = 0.05 + 0.2·smoothness and 1 − c of each segment,
 * 4/3/2/1 times for ≤10/≤30/≤100/more points. The ends stay put, except on
 * loops (which come back opened at their closing midpoint). Two points get
 * their midpoint inserted first.
 */
export function smoothPath(points: readonly Vec2[], smoothness: number, loop: boolean): Vec2[] {
  let pts = distinct(points)
  if (loop && pts.length > 2 && len(sub(pts[0], pts[pts.length - 1])) < 1e-9) pts.pop()
  if (pts.length < 2) return pts
  if (pts.length === 2) pts = [pts[0], mid(pts[0], pts[1]), pts[1]]
  const n = pts.length
  const iterations = n <= 10 ? 4 : n <= 30 ? 3 : n <= 100 ? 2 : 1
  const c = 0.05 + 0.2 * Math.min(1, Math.max(0, smoothness))
  const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  })
  for (let k = 0; k < iterations; k++) {
    const next: Vec2[] = loop ? [] : [pts[0]]
    const segs = loop ? pts.length : pts.length - 1
    for (let i = 0; i < segs; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      next.push(lerp(a, b, c), lerp(a, b, 1 - c))
    }
    if (!loop) next.push(pts[pts.length - 1])
    pts = next
  }
  return loop ? openLoop(pts) : pts
}

export type PathTransition = "none" | "fade" | "growth"

/** Most points a path's grow/shrink taper spans. */
const TAPER_MAX_POINTS = 50

/** Fraction of the length each end's fade spans. */
const FADE_SPAN = 0.1

/**
 * Per-point widths of a smoothed path of width `w`: Grow (at the start) and
 * Shrink (at the end) ease from 0 over a third of the points (at most
 * {@link TAPER_MAX_POINTS}) — counted in points, not distance, as
 * Dungeondraft does.
 */
export function pathWidths(count: number, w: number, grow: boolean, shrink: boolean): number[] {
  const n = Math.min(TAPER_MAX_POINTS, Math.floor(count / 3))
  return Array.from({ length: count }, (_, k) => {
    let width = w
    if (grow && k < n) width *= easeInOut(k / n)
    const back = count - 1 - k
    if (shrink && back < n) width *= easeInOut(back / n)
    return width
  })
}

/** A path's opacity at `f` of its length: linear fades over the first/last 10%. */
export function pathAlpha(f: number, fadeIn: boolean, fadeOut: boolean): number {
  let a = 1
  if (fadeIn && f < FADE_SPAN) a = Math.min(a, f / FADE_SPAN)
  if (fadeOut && f > 1 - FADE_SPAN) a = Math.min(a, (1 - f) / FADE_SPAN)
  return Math.max(0, a)
}

/** Sections across a path (left edge → right edge, v = 0 … 1). */
const PATH_V = [0, 0.25, 0.5, 0.75, 1]

/**
 * Triangles of a path along its smoothed `points`, with one width per
 * point: a section of 5 vertices per point, joined by 4 strips of quads.
 * The normal at an inner point bisects its two segments and the half-width
 * isn't corrected for the angle (paths thin a little on bends, and tight
 * bends can fold on the inner side), as in Dungeondraft. With fades, extra
 * sections are added inside the fade spans so the opacity ramps smoothly.
 */
export function pathTriangles(
  points: readonly Vec2[],
  widths: readonly number[],
  fadeIn: boolean,
  fadeOut: boolean,
): LineTriangle[] {
  let pts = points.map((p, i) => ({ ...p, w: widths[i] ?? 0 }))
  pts = pts.filter((p, i) => i === 0 || len(sub(p, pts[i - 1])) > 1e-9)
  if (pts.length < 2) return []
  const total = pts.slice(1).reduce((s, p, i) => s + len(sub(p, pts[i])), 0)
  if (total <= 0) return []
  if (fadeIn || fadeOut) pts = refineFades(pts, total)
  const n = pts.length
  const dirs = pts.slice(1).map((p, i) => unit(sub(p, pts[i])))
  const out: LineTriangle[] = []
  let prev: { verts: LineVertex[]; alpha: number } | null = null
  let dist = 0
  for (let i = 0; i < n; i++) {
    if (i > 0) dist += len(sub(pts[i], pts[i - 1]))
    const tangent = i === 0 ? dirs[0] : i === n - 1 ? dirs[n - 2] : unit(add(dirs[i - 1], dirs[i]))
    const nrm = normal(tangent)
    const hw = pts[i].w / 2
    const verts = PATH_V.map((v) => {
      const q = add(pts[i], scale(nrm, hw * (1 - 2 * v)))
      return { x: q.x, y: q.y, u: dist, v }
    })
    const alpha = pathAlpha(dist / total, fadeIn, fadeOut)
    if (prev) {
      const a = (prev.alpha + alpha) / 2
      for (let k = 0; k + 1 < PATH_V.length; k++) {
        const [p0, p1, q0, q1] = [prev.verts[k], prev.verts[k + 1], verts[k], verts[k + 1]]
        out.push({ a: p0, b: p1, c: q0, alpha: a }, { a: p1, b: q1, c: q0, alpha: a })
      }
    }
    prev = { verts, alpha }
  }
  return out
}

/** Sections per fade span: enough that the stepped opacity reads as a ramp. */
const FADE_STEPS = 24

/** Extra collinear points inside the fade spans (widths interpolated). */
function refineFades<P extends Vec2 & { w: number }>(pts: P[], total: number): P[] {
  const step = (total * FADE_SPAN) / FADE_STEPS
  const out: P[] = [pts[0]]
  let dist = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const l = len(sub(b, a))
    const inFade = (d: number) => d / total < FADE_SPAN || d / total > 1 - FADE_SPAN
    const pieces = inFade(dist) || inFade(dist + l) ? Math.max(1, Math.ceil(l / step)) : 1
    for (let k = 1; k < pieces; k++) {
      const t = k / pieces
      out.push({
        ...b,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        w: a.w + (b.w - a.w) * t,
      })
    }
    out.push(b)
    dist += l
  }
  return out
}
