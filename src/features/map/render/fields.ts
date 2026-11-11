import { type Vec2 } from "../model/types"

/**
 * Raster helpers for painted areas (water, caves): a distance field over a
 * mask, iso-contours of a field as polylines (marching squares) and their
 * simplification.
 */

const INF = 1e20

/** Felzenszwalb–Huttenlocher 1D squared distance transform of `f` (in place via `d`). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

/**
 * For every inside cell of `inside` (w × h, row-major), its Euclidean
 * distance (in cells) to the nearest outside cell; 0 outside. Cells past the
 * grid's border count as outside.
 */
export function distanceField(inside: Uint8Array, w: number, h: number): Float32Array {
  // Pad by one cell of "outside" all around.
  const W = w + 2
  const H = h + 2
  const grid = new Float64Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ix = x - 1
      const iy = y - 1
      const isIn = ix >= 0 && iy >= 0 && ix < w && iy < h && inside[iy * w + ix] !== 0
      grid[y * W + x] = isIn ? INF : 0
    }
  }
  const n = Math.max(W, H)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x]
    edt1d(f, H, d, v, z)
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y]
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x]
    edt1d(f, W, d, v, z)
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x]
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(grid[(y + 1) * W + x + 1])
  }
  return out
}

/**
 * Closed contours where `field` (w × h samples at cell centers, row-major)
 * crosses `level`, as polylines in cell units (a sample at (x + 0.5, y + 0.5)).
 * Outside the grid counts as below the level, so every contour closes.
 */
export function isoContours(field: Float32Array, w: number, h: number, level: number): Vec2[][] {
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? -Infinity : field[y * w + x]
  /** Point on the edge between samples a and b where the field meets the level. */
  const lerp = (ax: number, ay: number, bx: number, by: number): Vec2 => {
    const va = at(ax, ay)
    const vb = at(bx, by)
    const t =
      va === vb || !Number.isFinite(va) || !Number.isFinite(vb)
        ? 0.5
        : Math.min(1, Math.max(0, (level - va) / (vb - va)))
    return { x: ax + (bx - ax) * t + 0.5, y: ay + (by - ay) * t + 0.5 }
  }
  // Segments, linked into loops by their shared endpoints (each crossing
  // point belongs to exactly two segments of the same contour).
  const key = (p: Vec2) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`
  const segs: [Vec2, Vec2][] = []
  const byPoint = new Map<string, number[]>()
  const add = (a: Vec2, b: Vec2) => {
    const id = segs.length
    segs.push([a, b])
    for (const p of [a, b]) {
      const k = key(p)
      const list = byPoint.get(k)
      if (list) list.push(id)
      else byPoint.set(k, [id])
    }
  }
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      // Corners: a (x,y) b (x+1,y) c (x+1,y+1) d (x,y+1).
      const a = at(x, y) >= level
      const b = at(x + 1, y) >= level
      const c = at(x + 1, y + 1) >= level
      const d = at(x, y + 1) >= level
      const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0)
      if (code === 0 || code === 15) continue
      const top = () => lerp(x, y, x + 1, y)
      const right = () => lerp(x + 1, y, x + 1, y + 1)
      const bottom = () => lerp(x, y + 1, x + 1, y + 1)
      const left = () => lerp(x, y, x, y + 1)
      switch (code) {
        case 1:
        case 14:
          add(left(), top())
          break
        case 2:
        case 13:
          add(top(), right())
          break
        case 3:
        case 12:
          add(left(), right())
          break
        case 4:
        case 11:
          add(right(), bottom())
          break
        case 6:
        case 9:
          add(top(), bottom())
          break
        case 7:
        case 8:
          add(left(), bottom())
          break
        case 5: // Saddles: keep the two inside corners apart.
          add(left(), bottom())
          add(top(), right())
          break
        case 10:
          add(left(), top())
          add(right(), bottom())
          break
      }
    }
  }
  const used = new Uint8Array(segs.length)
  const loops: Vec2[][] = []
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue
    used[s0] = 1
    const loop = [segs[s0][0]]
    let cur = segs[s0][1]
    const startKey = key(segs[s0][0])
    for (let guard = 0; guard < segs.length; guard++) {
      const k = key(cur)
      if (k === startKey) break
      loop.push(cur)
      const nextId = (byPoint.get(k) ?? []).find((id) => !used[id])
      if (nextId === undefined) break
      used[nextId] = 1
      const [p, q] = segs[nextId]
      cur = key(p) === k ? q : p
    }
    if (loop.length > 2) loops.push(loop)
  }
  return loops
}

/** Distance from `p` to segment ab. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/** Ramer–Douglas–Peucker on an open polyline. */
function rdp(pts: readonly Vec2[], eps: number): Vec2[] {
  if (pts.length < 3) return [...pts]
  let index = 0
  let max = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > max) {
      max = d
      index = i
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]]
  const left = rdp(pts.slice(0, index + 1), eps)
  return [...left.slice(0, -1), ...rdp(pts.slice(index), eps)]
}

/** A closed loop simplified to within `eps` (split at its farthest point so both halves keep it). */
export function simplifyLoop(loop: readonly Vec2[], eps: number): Vec2[] {
  if (loop.length < 4) return [...loop]
  let far = 0
  let max = 0
  loop.forEach((p, i) => {
    const d = Math.hypot(p.x - loop[0].x, p.y - loop[0].y)
    if (d > max) {
      max = d
      far = i
    }
  })
  const a = rdp(loop.slice(0, far + 1), eps)
  const b = rdp([...loop.slice(far), loop[0]], eps)
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

/**
 * Dungeondraft's water rings: inner offsets at 0.333, 0.75, 1.5, 2 and 4
 * tiles, up to the first one at or past `blend` (clipped to it), each
 * colored at distance / blend of the way from shallow to deep. Returns
 * (distance, weight) stops from the shore, the GPU interpolating linearly
 * between them.
 */
export function waterRamp(blend: number): { d: number; t: number }[] {
  const b = Math.max(0.01, blend)
  const stops = [{ d: 0, t: 0 }]
  for (const d of [0.333, 0.75, 1.5, 2, 4]) {
    if (d >= b) {
      stops.push({ d: b, t: 1 })
      return stops
    }
    stops.push({ d, t: d / b })
  }
  return stops
}

/** The ramp's weight `distance` tiles from the shore (1 past the last stop). */
export function rampAt(stops: readonly { d: number; t: number }[], distance: number): number {
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (distance <= b.d) return a.t + ((b.t - a.t) * (distance - a.d)) / (b.d - a.d || 1)
  }
  return stops[stops.length - 1].t
}
