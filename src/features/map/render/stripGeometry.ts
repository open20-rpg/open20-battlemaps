import { type Vec2 } from "../model/types"

/**
 * Mesh geometry for a textured strip along a polyline (walls, paths) with
 * continuous texture through the corners — the way Godot's Line2D (and so
 * Dungeondraft) draws sharp joints.
 *
 * Each segment is a rectangle trimmed back from its corners, so the texture
 * runs straight along it. Each corner is filled by two triangles sharing the
 * inner miter point: on the outer side the texture keeps advancing around
 * the bend (stretched), on the inner side it pinches into the miter point
 * (compressed). The texture coordinate along the strip (u) is therefore
 * continuous end to end: patterns flow through corners without jumps.
 *
 * Everything is in map space; `u` is in tiles along the strip (divide by the
 * texture's repeat length), `v` is 0 on the left side and 1 on the right.
 */

export interface StripVertex {
  x: number
  y: number
  u: number
  v: number
}

/** One triangle, with the opacity it should be drawn at (path fades). */
export interface StripTriangle {
  a: StripVertex
  b: StripVertex
  c: StripVertex
  alpha: number
}

/** Longest corner trim, in half-widths, before very sharp corners are clamped. */
const MAX_TRIM = 4

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
const len = (v: Vec2) => Math.hypot(v.x, v.y)
const unit = (v: Vec2): Vec2 => {
  const l = len(v) || 1
  return { x: v.x / l, y: v.y / l }
}
const along = (p: Vec2, d: Vec2, k: number): Vec2 => ({ x: p.x + d.x * k, y: p.y + d.y * k })
/** Left normal (rotate 90°). */
const normal = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x })

interface Corner {
  /** How far each adjoining segment is cut back from the corner point. */
  trim: number
  /** The trim a clean miter needs; larger than `trim` when a segment was too short. */
  ideal: number
  /** +1 when the outer side of the bend is the left side, −1 when right. */
  outer: 1 | -1
}

/**
 * Triangles of a strip along `points`. `widths` is one width per point (or
 * a single width); `alphas` one opacity per point (defaults to opaque).
 */
export function stripTriangles(
  points: readonly Vec2[],
  closed: boolean,
  widths: number | readonly number[],
  alphas?: readonly number[],
): StripTriangle[] {
  // Drop zero-length segments: they have no direction.
  const keep = points
    .map((_, i) => i)
    .filter((i) => i === 0 || len(sub(points[i], points[i - 1])) > 1e-9)
  const pts = keep.map((i) => points[i])
  const w = (k: number) => (typeof widths === "number" ? widths : (widths[keep[k]] ?? 0))
  const al = (k: number) => alphas?.[keep[k]] ?? 1
  const n = pts.length
  if (closed && n > 2 && len(sub(pts[0], pts[n - 1])) < 1e-9) pts.pop()
  const count = pts.length
  if (count < 2) return []
  const segCount = closed && count > 2 ? count : count - 1
  const dirs = Array.from({ length: segCount }, (_, s) => unit(sub(pts[(s + 1) % count], pts[s])))
  const lens = Array.from({ length: segCount }, (_, s) => len(sub(pts[(s + 1) % count], pts[s])))

  // Corner at point i between segment i−1 (incoming) and i (outgoing).
  const corners: (Corner | null)[] = pts.map((_, i) => {
    const hasIn = closed && count > 2 ? true : i > 0
    const hasOut = closed && count > 2 ? true : i < count - 1
    if (!hasIn || !hasOut) return null
    const d1 = dirs[(i - 1 + segCount) % segCount]
    const d2 = dirs[i % segCount]
    const cross = d1.x * d2.y - d1.y * d2.x
    const dot = Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y))
    const turn = Math.acos(dot)
    if (turn < 1e-4) return null
    const half = w(i) / 2
    // Turning toward the left normal makes the right side the outer one.
    const outer: 1 | -1 = cross > 0 ? -1 : 1
    const limit = Math.min(
      half * MAX_TRIM,
      lens[(i - 1 + segCount) % segCount] / 2,
      lens[i % segCount] / 2,
    )
    const ideal = Math.min(half * Math.tan(turn / 2), half * MAX_TRIM)
    return { trim: Math.min(ideal, limit), ideal, outer }
  })

  const tris: StripTriangle[] = []
  const vtx = (p: Vec2, u: number, v: number): StripVertex => ({ x: p.x, y: p.y, u, v })
  let u = 0
  for (let s = 0; s < segCount; s++) {
    const i0 = s
    const i1 = (s + 1) % count
    const d = dirs[s]
    const nrm = normal(d)
    const t0 = corners[i0]?.trim ?? 0
    const t1 = corners[i1]?.trim ?? 0
    const a = along(pts[i0], d, t0)
    const b = along(pts[i1], d, -t1)
    const h0 = w(i0) / 2
    const h1 = w(i1) / 2
    const rectLen = Math.max(0, lens[s] - t0 - t1)
    const alpha = (al(i0) + al(i1)) / 2
    const aL = vtx(along(a, nrm, h0), u, 0)
    const aR = vtx(along(a, nrm, -h0), u, 1)
    const bL = vtx(along(b, nrm, h1), u + rectLen, 0)
    const bR = vtx(along(b, nrm, -h1), u + rectLen, 1)
    tris.push({ a: aL, b: aR, c: bL, alpha }, { a: aR, b: bR, c: bL, alpha })
    u += rectLen

    // Corner fill at the end of this segment (if the next one turns).
    const corner = corners[i1]
    if (!corner || (!closed && s === segCount - 1)) continue
    const dNext = dirs[(s + 1) % segCount]
    const nNext = normal(dNext)
    const half = w(i1) / 2
    const m = corner.trim
    const vOut = corner.outer === 1 ? 0 : 1
    const vIn = 1 - vOut
    const o1 = along(b, nrm, half * corner.outer)
    const inner = along(b, nrm, -half * corner.outer)
    const miter = along(o1, d, 2 * m)
    const o2 = along(along(pts[i1], dNext, m), nNext, half * corner.outer)
    const ca = al(i1)
    if (corner.trim < corner.ideal - 1e-9) {
      // A neighbouring segment is too short for a clean miter: the trimmed
      // rectangles no longer meet at one inner point. Fan the outer side
      // around the corner vertex up to the true miter instead (the inner
      // sides overlap, so they leave no gap); the texture holds still here.
      const c = pts[i1]
      const trueMiter = along(along(c, d, corner.ideal), nrm, half * corner.outer)
      const bCenter = along(c, d, -m)
      const aCenter = along(c, dNext, m)
      const v = (p: Vec2, side: number) => vtx(p, u, side)
      tris.push(
        { a: v(bCenter, 0.5), b: v(o1, vOut), c: v(c, 0.5), alpha: ca },
        { a: v(c, 0.5), b: v(o1, vOut), c: v(trueMiter, vOut), alpha: ca },
        { a: v(c, 0.5), b: v(trueMiter, vOut), c: v(o2, vOut), alpha: ca },
        { a: v(c, 0.5), b: v(o2, vOut), c: v(aCenter, 0.5), alpha: ca },
      )
      u += 2 * m
      continue
    }
    tris.push(
      { a: vtx(o1, u, vOut), b: vtx(miter, u + m, vOut), c: vtx(inner, u, vIn), alpha: ca },
      {
        a: vtx(miter, u + m, vOut),
        b: vtx(o2, u + 2 * m, vOut),
        c: vtx(inner, u + 2 * m, vIn),
        alpha: ca,
      },
    )
    u += 2 * m
  }
  return tris
}
