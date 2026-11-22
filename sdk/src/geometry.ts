/**
 * Pure geometry helpers that run inside the extension (no host call).
 * Heavier operations (boolean ops on many polygons, rooms, visibility) are
 * host utilities: see `ctx.analysis`.
 */
import { type Rect, type Vec2 } from "./types"

export const vec = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

/** Rotate `p` around `pivot` by `deg` degrees (clockwise on screen). */
export function rotate(p: Vec2, deg: number, pivot: Vec2 = { x: 0, y: 0 }): Vec2 {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const dx = p.x - pivot.x
  const dy = p.y - pivot.y
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c }
}

/** Signed area (positive when counter-clockwise in y-down screen space is negative). */
export function signedArea(poly: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export const area = (poly: readonly Vec2[]): number => Math.abs(signedArea(poly))

export function centroid(poly: readonly Vec2[]): Vec2 {
  const a = signedArea(poly)
  if (Math.abs(a) < 1e-12) {
    const n = poly.length || 1
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      y: poly.reduce((s, p) => s + p.y, 0) / n,
    }
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside
  }
  return inside
}

export function bounds(points: readonly Vec2[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export const rectPoints = (r: Rect): Vec2[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
]

export const rectContains = (r: Rect, p: Vec2): boolean =>
  p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

/** Distance from `p` to the segment a–b. */
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  if (l2 === 0) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2))
  return dist(p, lerp(a, b, t))
}

/** Ramer–Douglas–Peucker simplification of a polyline. */
export function simplify(points: readonly Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) return [...points]
  let max = 0
  let index = 0
  const last = points.length - 1
  for (let i = 1; i < last; i++) {
    const d = segmentDistance(points[i], points[0], points[last])
    if (d > max) {
      max = d
      index = i
    }
  }
  if (max <= tolerance) return [points[0], points[last]]
  const left = simplify(points.slice(0, index + 1), tolerance)
  const right = simplify(points.slice(index), tolerance)
  return [...left.slice(0, -1), ...right]
}

/** A regular polygon (hexes, octagons…). */
export function regularPolygon(center: Vec2, radius: number, sides: number, startDeg = 0): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const r = ((startDeg + (360 / sides) * i) * Math.PI) / 180
    return { x: center.x + radius * Math.cos(r), y: center.y + radius * Math.sin(r) }
  })
}

/** Points every `step` along a polyline (for placing things along a path). */
export function resample(points: readonly Vec2[], step: number): Vec2[] {
  if (points.length === 0 || step <= 0) return []
  const out: Vec2[] = [points[0]]
  let carry = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const len = dist(a, b)
    let t = step - carry
    while (t <= len) {
      out.push(lerp(a, b, t / len))
      t += step
    }
    carry = len - (t - step)
  }
  return out
}

/** Chaikin smoothing of a polyline (`closed` wraps around). */
export function smooth(points: readonly Vec2[], iterations = 2, closed = false): Vec2[] {
  let pts = [...points]
  for (let k = 0; k < iterations; k++) {
    const next: Vec2[] = []
    const n = pts.length
    const count = closed ? n : n - 1
    if (!closed) next.push(pts[0])
    for (let i = 0; i < count; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      next.push(lerp(a, b, 0.25), lerp(a, b, 0.75))
    }
    if (!closed) next.push(pts[n - 1])
    pts = next
  }
  return pts
}
