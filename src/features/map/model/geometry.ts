import { type MapEntity, type Vec2 } from "./types"

/**
 * Pure geometry used by tool behaviors (placement, snapping, editing) and the
 * renderer/selection (bounds, hit-testing). Everything works in map tile units.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Size of an asset in tiles, if known (textures are loaded lazily). */
export type AssetSizeOf = (assetId: string) => { w: number; h: number } | undefined

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Round a point to the nearest multiple of `step` (tiles) on both axes. */
export function snapPoint(p: Vec2, step: number): Vec2 {
  if (step <= 0) return p
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step }
}

/** Rotate `p` by `degrees` around `center`. */
export function rotateAround(p: Vec2, center: Vec2, degrees: number): Vec2 {
  const r = (degrees * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

/** Closest point to `p` on segment `a`–`b`, plus the segment parameter `t` in [0,1]. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return { point: { x: a.x + dx * t, y: a.y + dy * t }, t }
}

/** Segments of a polyline (plus the closing one when `closed`). */
export function segmentsOf(points: readonly Vec2[], closed = false): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = []
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i], points[i + 1]])
  if (closed && points.length > 2) out.push([points[points.length - 1], points[0]])
  return out
}

export function distToPolyline(p: Vec2, points: readonly Vec2[], closed = false): number {
  if (points.length === 1) return dist(p, points[0])
  let best = Infinity
  for (const [a, b] of segmentsOf(points, closed))
    best = Math.min(best, dist(p, closestOnSegment(p, a, b).point))
  return best
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** Axis-aligned rectangle spanned by two corners, as a closed polygon. */
export function rectPolygon(a: Vec2, b: Vec2): Vec2[] {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
}

/** Ellipse inscribed in the rectangle spanned by `a`/`b`, as a closed polygon. */
export function ellipsePolygon(a: Vec2, b: Vec2, segments = 48): Vec2[] {
  const cx = (a.x + b.x) / 2
  const cy = (a.y + b.y) / 2
  const rx = Math.abs(b.x - a.x) / 2
  const ry = Math.abs(b.y - a.y) / 2
  const out: Vec2[] = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) })
  }
  return out
}

/** Smallest rect containing every point (zero-size for a single point). */
export function boundsOf(points: readonly Vec2[]): Rect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of points) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 }
}

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

/** Normalize a drag between two points into a rect. */
export function rectFromCorners(a: Vec2, b: Vec2): Rect {
  return boundsOf([a, b])
}

/** The first asset id an entity renders with (objects, portals, lights…). */
export function entityAssetId(entity: MapEntity): string | undefined {
  const asset = entity.params.asset
  return typeof asset === "string" ? asset : undefined
}

/**
 * Rough on-map footprint of a text label (the canvas measures the real one;
 * this only needs to be close enough for clicking and selection boxes).
 */
export function textSize(entity: MapEntity): { w: number; h: number } {
  const fontSize = typeof entity.params.fontSize === "number" ? entity.params.fontSize : 32
  const size = fontSize / 64
  const lines = (entity.text ?? "").split("\n")
  const longest = Math.max(1, ...lines.map((l) => l.length))
  return { w: longest * size * 0.6, h: lines.length * size * 1.2 }
}

/** On-map footprint size of a sprite-like entity (object/portal/light/text), in tiles. */
export function spriteSize(entity: MapEntity, sizeOf: AssetSizeOf): { w: number; h: number } {
  if (entity.toolId === "text") return textSize(entity)
  const id = entityAssetId(entity)
  const base = (id && sizeOf(id)) || { w: 1, h: 1 }
  const s = entity.scale ?? 1
  return { w: base.w * s, h: base.h * s }
}

/** Corners of a sprite-like entity's rotated footprint. */
function spriteCorners(entity: MapEntity, sizeOf: AssetSizeOf): Vec2[] {
  const { w, h } = spriteSize(entity, sizeOf)
  const c = entity.position
  // Rotation is clockwise on screen; map x is mirrored, so in map space the
  // same turn is counter-clockwise.
  return rectPolygon({ x: c.x - w / 2, y: c.y - h / 2 }, { x: c.x + w / 2, y: c.y + h / 2 }).map(
    (p) => rotateAround(p, c, -entity.rotation),
  )
}

/** Half-width of a stroked line entity (walls, paths) in tiles. */
export function lineHalfWidth(entity: MapEntity): number {
  const width = entity.params.width
  return typeof width === "number" ? width / 2 : 0.15
}

/** Axis-aligned bounds of an entity, for selection boxes and rubber-band selection. */
export function entityBounds(entity: MapEntity, sizeOf: AssetSizeOf): Rect {
  if (entity.strokes && entity.strokes.length > 0) {
    const pts = entity.strokes.flatMap((s) => s.points)
    const r = Math.max(...entity.strokes.map((s) => s.radius))
    return inflate(boundsOf(pts), r)
  }
  if (entity.points && entity.points.length > 0) {
    return inflate(boundsOf(entity.points), entity.closed ? 0 : lineHalfWidth(entity))
  }
  return boundsOf(spriteCorners(entity, sizeOf))
}

/** Whether `p` falls on the entity (hit test used by the Select tool). */
/**
 * Entities picked only along their outline, never by their interior: a
 * closed wall encloses a room, and clicking inside the room must reach what
 * is in it (furniture, the floor), not the wall around it.
 */
const OUTLINE_ONLY_TOOLS = new Set(["wall"])

export function entityHit(
  entity: MapEntity,
  p: Vec2,
  sizeOf: AssetSizeOf,
  tolerance = 0.2,
): boolean {
  if (entity.strokes && entity.strokes.length > 0) {
    return entity.strokes.some((s) => !s.erase && distToPolyline(p, s.points) <= s.radius)
  }
  if (entity.points && entity.points.length > 0) {
    const area = entity.closed && entity.points.length > 2 && !OUTLINE_ONLY_TOOLS.has(entity.toolId)
    if (area && pointInPolygon(p, entity.points)) return true
    return distToPolyline(p, entity.points, entity.closed) <= lineHalfWidth(entity) + tolerance
  }
  return pointInPolygon(p, spriteCorners(entity, sizeOf))
}

/**
 * Topmost entity under `p`: highest layer first, then the latest placed
 * within a layer (document order is draw order inside a layer).
 */
export function hitTest(
  entities: readonly MapEntity[],
  p: Vec2,
  sizeOf: AssetSizeOf,
  filter?: (e: MapEntity) => boolean,
): MapEntity | undefined {
  let best: { e: MapEntity; i: number } | undefined
  entities.forEach((e, i) => {
    if (filter && !filter(e)) return
    if (!entityHit(e, p, sizeOf)) return
    if (!best || e.layer > best.e.layer || (e.layer === best.e.layer && i > best.i)) best = { e, i }
  })
  return best?.e
}

/** Translate every coordinate of an entity by `d` (moving a selection). */
export function translateEntity(entity: MapEntity, d: Vec2): MapEntity {
  return {
    ...entity,
    position: add(entity.position, d),
    points: entity.points?.map((p) => add(p, d)),
    strokes: entity.strokes?.map((s) => ({ ...s, points: s.points.map((p) => add(p, d)) })),
  }
}

/**
 * Append a brush sample only when it's far enough from the last one, so a
 * slow drag doesn't store thousands of overlapping points.
 */
export function appendSample(points: readonly Vec2[], p: Vec2, minSpacing: number): Vec2[] {
  const last = points[points.length - 1]
  if (last && dist(last, p) < minSpacing) return points as Vec2[]
  return [...points, p]
}

/** Nearest vertex (index) of `points` within `maxDist` of `p`, if any. */
export function nearestVertex(
  points: readonly Vec2[],
  p: Vec2,
  maxDist: number,
): number | undefined {
  let best: number | undefined
  let bestD = maxDist
  points.forEach((v, i) => {
    const d = dist(v, p)
    if (d <= bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

let counter = 0
/** Unique id for new entities (time + counter + random, collision-safe in practice). */
export function newId(prefix = "e"): string {
  counter = (counter + 1) % 1e6
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** A drawable stretch of wall; `capA`/`capB` mark ends that sit on a corner (to overlap the joint). */
export interface WallPiece {
  a: Vec2
  b: Vec2
  capA: boolean
  capB: boolean
}

/** An opening a portal cuts into a wall: centered on the wall, `width` tiles wide. */
export interface WallOpening {
  center: Vec2
  width: number
}

/** How close (tiles) a portal center must be to a wall segment to cut it. */
const OPENING_TOLERANCE = 0.05

/**
 * Split a wall polyline into the pieces left after cutting out portal
 * openings. Pieces that end on an interior corner are flagged so the
 * renderer can extend them over the joint (no gaps at sharp angles).
 */
export function wallPieces(
  points: readonly Vec2[],
  closed: boolean,
  openings: readonly WallOpening[],
): WallPiece[] {
  const segments = segmentsOf(points, closed)
  const pieces: WallPiece[] = []
  segments.forEach(([a, b], i) => {
    const len = dist(a, b)
    if (len === 0) return
    const lerp = (t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    const cuts = openings
      .map((o) => {
        const { point, t } = closestOnSegment(o.center, a, b)
        if (dist(point, o.center) > OPENING_TOLERANCE) return null
        const half = o.width / 2 / len
        return [Math.max(0, t - half), Math.min(1, t + half)] as const
      })
      .filter((c): c is readonly [number, number] => c !== null)
      .sort((x, y) => x[0] - y[0])
    const cornerStart = closed || i > 0
    const cornerEnd = closed || i < segments.length - 1
    let start = 0
    for (const [t0, t1] of cuts) {
      if (t0 > start)
        pieces.push({ a: lerp(start), b: lerp(t0), capA: start === 0 && cornerStart, capB: false })
      start = Math.max(start, t1)
    }
    if (start < 1)
      pieces.push({ a: lerp(start), b: b, capA: start === 0 && cornerStart, capB: cornerEnd })
  })
  return pieces
}

/** A continuous stretch of wall to draw as one strip (joined corners). */
export interface WallRun {
  points: Vec2[]
  closed: boolean
}

/**
 * Group wall pieces into continuous runs: consecutive pieces that meet at a
 * corner become one polyline, so the renderer can join corners with miters
 * instead of overlapping separate strips. A closed wall without openings
 * stays one closed run; openings split it into open runs (the run crossing
 * the first vertex is stitched back together).
 */
export function wallRuns(
  points: readonly Vec2[],
  closed: boolean,
  openings: readonly WallOpening[],
): WallRun[] {
  const pieces = wallPieces(points, closed, openings)
  if (pieces.length === 0) return []
  const cut = pieces.some((p) => !p.capA || !p.capB)
  if (closed && !cut) return [{ points: pieces.map((p) => p.a), closed: true }]
  const runs: Vec2[][] = []
  for (const p of pieces) {
    const current = runs[runs.length - 1]
    if (p.capA && current) current.push(p.b)
    else runs.push([p.a, p.b])
  }
  // A closed wall's first piece continues the last run across vertex 0.
  if (closed && runs.length > 1 && pieces[0].capA) {
    const first = runs.shift() as Vec2[]
    runs[runs.length - 1].push(...first.slice(1))
  }
  return runs.map((r) => ({ points: r, closed: false }))
}

/** Longest miter, in half-widths, before a very sharp corner is clamped. */
const MITER_LIMIT = 4

/**
 * Left/right outline vertices of a strip of `width` along `points`, with
 * mitered joins (clamped at sharp angles) — the geometry of a wall run.
 * Returned per input point (closed runs join the last point to the first).
 */
export function stripOutline(
  points: readonly Vec2[],
  closed: boolean,
  width: number,
): { left: Vec2; right: Vec2 }[] {
  const n = points.length
  const half = width / 2
  const dirOf = (a: Vec2, b: Vec2): Vec2 => {
    const len = dist(a, b) || 1
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  }
  return points.map((p, i) => {
    const prev = i > 0 ? points[i - 1] : closed ? points[n - 1] : undefined
    const next = i < n - 1 ? points[i + 1] : closed ? points[0] : undefined
    const dIn = prev ? dirOf(prev, p) : undefined
    const dOut = next ? dirOf(p, next) : undefined
    const d1 = dIn ?? dOut ?? { x: 1, y: 0 }
    const d2 = dOut ?? dIn ?? { x: 1, y: 0 }
    // Normals (rotate 90°), averaged into the miter direction.
    const n1 = { x: -d1.y, y: d1.x }
    const n2 = { x: -d2.y, y: d2.x }
    let mx = n1.x + n2.x
    let my = n1.y + n2.y
    const mlen = Math.hypot(mx, my)
    if (mlen < 1e-9) {
      // A full U-turn: no miter exists; use the incoming normal.
      mx = n1.x
      my = n1.y
    } else {
      mx /= mlen
      my /= mlen
    }
    const cos = mx * n1.x + my * n1.y
    const len = Math.min(half / Math.max(cos, 1e-6), half * MITER_LIMIT)
    return {
      left: { x: p.x + mx * len, y: p.y + my * len },
      right: { x: p.x - mx * len, y: p.y - my * len },
    }
  })
}

/** Union of the entities' bounds (selection box), or null for none. */
export function selectionBounds(entities: readonly MapEntity[], sizeOf: AssetSizeOf): Rect | null {
  if (entities.length === 0) return null
  const corners = entities.flatMap((e) => {
    const b = entityBounds(e, sizeOf)
    return [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
    ]
  })
  return boundsOf(corners)
}

/** Screen px between the selection box's top edge and its rotate handle. */
const ROTATE_HANDLE_GAP_PX = 24

/**
 * Where the selection's transform handles sit: the box corners (uniform
 * scale) and a rotate handle above the box's top-center. `tile` is the size
 * of one screen pixel in tiles, so the gap stays constant on screen.
 */
export function transformHandles(box: Rect, pxInTiles: number): { corners: Vec2[]; rotate: Vec2 } {
  return {
    corners: rectPolygon({ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h }),
    rotate: { x: box.x + box.w / 2, y: box.y - ROTATE_HANDLE_GAP_PX * pxInTiles },
  }
}

/**
 * Rotate (`screenDegrees`, clockwise on screen) and uniformly scale
 * (`factor`) an entity around `center`. Every coordinate moves; sprite-like
 * entities also turn and grow, brush strokes widen. Map x is mirrored, so a
 * clockwise turn on screen is counter-clockwise in map space.
 */
export function transformEntity(
  entity: MapEntity,
  center: Vec2,
  screenDegrees: number,
  factor: number,
): MapEntity {
  const move = (p: Vec2): Vec2 => {
    const r = rotateAround(p, center, -screenDegrees)
    return { x: center.x + (r.x - center.x) * factor, y: center.y + (r.y - center.y) * factor }
  }
  const sprite = !entity.points && !entity.strokes
  return {
    ...entity,
    position: move(entity.position),
    rotation: sprite ? normalizeDegrees(entity.rotation + screenDegrees) : entity.rotation,
    scale: sprite ? (entity.scale ?? 1) * factor : entity.scale,
    points: entity.points?.map(move),
    strokes: entity.strokes?.map((s) => ({
      ...s,
      radius: s.radius * factor,
      points: s.points.map(move),
    })),
  }
}

/** Wrap an angle to (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180
  return d === -180 ? 180 : d
}
