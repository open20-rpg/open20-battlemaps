import { type Vec2 } from "./types"

/**
 * An image's silhouette: the outer outlines of its opaque part (alpha at
 * least half), as closed polygons in fractions of the image's size (0..1,
 * y down). Light-blocking objects and closed doors stop light along it, not
 * along their whole rectangle. Traced on a coarse grid (about
 * {@link GRID} cells along the longer side) and simplified, so a prop gives
 * a handful of segments; specks and holes are left out.
 */
export interface AlphaImage {
  w: number
  h: number
  /** One alpha byte per pixel, row by row. */
  data: Uint8Array
}

const GRID = 64
const OPAQUE = 128
/** Outlines smaller than this many cells are specks (a stray pixel, a shadow wisp). */
const MIN_CELLS = 3
/** Simplification tolerance, in cells. */
const TOLERANCE = 0.75

export function alphaOutline(img: AlphaImage): Vec2[][] {
  const { w, h, data } = img
  if (!w || !h) return []
  const cell = Math.max(1, Math.ceil(Math.max(w, h) / GRID))
  const gw = Math.ceil(w / cell)
  const gh = Math.ceil(h / cell)
  // A cell is solid when any of its pixels is opaque enough.
  const solid = new Uint8Array(gw * gh)
  for (let y = 0; y < h; y++) {
    const row = y * w
    const gy = Math.floor(y / cell) * gw
    for (let x = 0; x < w; x++) if (data[row + x] >= OPAQUE) solid[gy + Math.floor(x / cell)] = 1
  }
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < gw && y < gh && solid[y * gw + x] === 1
  // Boundary edges, clockwise around the solid (y down): from vertex → to vertex.
  const next = new Map<number, number[]>()
  const key = (x: number, y: number) => y * (gw + 1) + x
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay)
    const list = next.get(k)
    if (list) list.push(key(bx, by))
    else next.set(k, [key(bx, by)])
  }
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!at(x, y)) continue
      if (!at(x, y - 1)) add(x, y, x + 1, y)
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!at(x - 1, y)) add(x, y + 1, x, y)
    }
  }
  const loops: Vec2[][] = []
  for (const [start, outs] of next) {
    while (outs.length) {
      const loop: Vec2[] = []
      let k = start
      for (;;) {
        const list = next.get(k)
        const to = list?.pop()
        if (to === undefined) break
        loop.push({ x: k % (gw + 1), y: Math.floor(k / (gw + 1)) })
        k = to
        if (k === start) break
      }
      // Outer outlines run clockwise (positive area, y down); holes the other way.
      if (loop.length >= 4 && area(loop) >= MIN_CELLS) loops.push(loop)
    }
  }
  return loops.map((loop) =>
    simplify(loop).map((p) => ({
      x: Math.min(1, (p.x * cell) / w),
      y: Math.min(1, (p.y * cell) / h),
    })),
  )
}

/** Shoelace area, positive for a clockwise loop in y-down coordinates. */
function area(loop: readonly Vec2[]): number {
  let s = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

/** Douglas–Peucker on a closed loop: split at the two points farthest apart. */
function simplify(loop: readonly Vec2[]): Vec2[] {
  let far = 0
  let best = -1
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i].x - loop[0].x, loop[i].y - loop[0].y)
    if (d > best) {
      best = d
      far = i
    }
  }
  const a = dp([...loop.slice(0, far + 1)])
  const b = dp([...loop.slice(far), loop[0]])
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

function dp(pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts
  const a = pts[0]
  const b = pts[pts.length - 1]
  const ex = b.x - a.x
  const ey = b.y - a.y
  const len = Math.hypot(ex, ey)
  let idx = -1
  let max = -1
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const d =
      len > 0
        ? Math.abs((p.x - a.x) * ey - (p.y - a.y) * ex) / len
        : Math.hypot(p.x - a.x, p.y - a.y)
    if (d > max) {
      max = d
      idx = i
    }
  }
  if (max <= TOLERANCE) return [a, b]
  return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))]
}
