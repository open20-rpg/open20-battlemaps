import { FONT_PX_PER_TILE, textLayout } from "../../fonts/metrics"
import { drawLayer } from "./drawOrder"
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
/** Samples per tile when a rubber band looks for a sprite's opaque pixels. */
const BAND_SAMPLES_PER_TILE = 32
/** Most samples along each side (a big band over a big sprite stays cheap). */
const BAND_MAX_SAMPLES = 48

/**
 * Whether `band` covers some point of `bounds` where `solid` holds (a
 * sprite's opaque pixels), sampling their overlap on a grid fine enough for
 * a texture's detail. A band of no size (a click) samples its one point.
 */
export function bandTouchesSolid(band: Rect, bounds: Rect, solid: (p: Vec2) => boolean): boolean {
  const x0 = Math.max(band.x, bounds.x)
  const y0 = Math.max(band.y, bounds.y)
  const x1 = Math.min(band.x + band.w, bounds.x + bounds.w)
  const y1 = Math.min(band.y + band.h, bounds.y + bounds.h)
  if (x1 < x0 || y1 < y0) return false
  const steps = (size: number) =>
    Math.min(BAND_MAX_SAMPLES, Math.max(1, Math.ceil(size * BAND_SAMPLES_PER_TILE)))
  const nx = steps(x1 - x0)
  const ny = steps(y1 - y0)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = {
        x: nx === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (nx - 1),
        y: ny === 1 ? (y0 + y1) / 2 : y0 + ((y1 - y0) * j) / (ny - 1),
      }
      if (solid(p)) return true
    }
  }
  return false
}

export function rectFromCorners(a: Vec2, b: Vec2): Rect {
  return boundsOf([a, b])
}

/** The first asset id an entity renders with (objects, portals, lights…). */
export function entityAssetId(entity: MapEntity): string | undefined {
  const asset = entity.params.asset
  return typeof asset === "string" ? asset : undefined
}

/**
 * A text label's box in tiles (its font measured and laid out as in
 * fonts/metrics). Its position is the box's top-left corner.
 */
export function textSize(entity: MapEntity): { w: number; h: number } {
  const box = textLayout(entity.params, entity.text ?? "")
  const s = (entity.scale ?? 1) / FONT_PX_PER_TILE
  return { w: box.w * s, h: box.h * s }
}

/**
 * A text's position for its box centered on `center` (a text's position
 * is its box's top-left corner; screen-left is the larger map x). Turning,
 * scaling or mirroring a text moves its center, then this.
 */
const textCenter = (entity: MapEntity): Vec2 => spriteCenter(entity, textSize(entity))

function textAt(entity: MapEntity, center: Vec2): Vec2 {
  const { w, h } = textSize(entity)
  return { x: center.x + w / 2, y: center.y - h / 2 }
}

/**
 * The center of a sprite-like entity's footprint: its position, except a
 * text's, which is its top-left corner (screen-right is the smaller map x).
 */
export function spriteCenter(entity: MapEntity, size: { w: number; h: number }): Vec2 {
  const p = entity.position
  return entity.toolId === "text" ? { x: p.x - size.w / 2, y: p.y + size.h / 2 } : p
}

/** On-map footprint size of a sprite-like entity (object/portal/light/text), in tiles. */
/** A light's radius in tiles (its Range param). */
export function lightRange(entity: MapEntity): number {
  return typeof entity.params.range === "number" ? entity.params.range : 5
}

/** Clicks pick a light only this close (tiles) to its center, not anywhere it shines. */
const LIGHT_PICK_RADIUS = 0.35

export function spriteSize(entity: MapEntity, sizeOf: AssetSizeOf): { w: number; h: number } {
  if (entity.toolId === "text") return textSize(entity)
  // A light's footprint is its reach: the selection box (and its handles)
  // frames the area it lights.
  if (entity.toolId === "light") return { w: lightRange(entity) * 2, h: lightRange(entity) * 2 }
  const id = entityAssetId(entity)
  const base = (id && sizeOf(id)) || { w: 1, h: 1 }
  const s = entity.scale ?? 1
  return { w: base.w * s, h: base.h * s }
}

/** Corners of a sprite-like entity's rotated footprint. */
export function spriteCorners(entity: MapEntity, sizeOf: AssetSizeOf): Vec2[] {
  const size = spriteSize(entity, sizeOf)
  const { w, h } = size
  const c = spriteCenter(entity, size)
  // Rotation is clockwise on screen; map x is mirrored, so in map space the
  // same turn is counter-clockwise.
  return rectPolygon({ x: c.x - w / 2, y: c.y - h / 2 }, { x: c.x + w / 2, y: c.y + h / 2 }).map(
    (p) => rotateAround(p, c, -entity.rotation),
  )
}

/**
 * Where in a sprite's texture (object, portal) map point `p` falls, as
 * fractions of its width and height (0..1 inside it) — the renderer's
 * drawing undone (entities.ts): map x mirrored, rotated about its position,
 * flipped in its own frame. `size` is the texture's size in tiles at scale 1.
 */
export function spriteUV(entity: MapEntity, p: Vec2, size: { w: number; h: number }): Vec2 {
  // Content space (x mirrored), relative to the sprite's center.
  const dx = -(p.x - entity.position.x)
  const dy = p.y - entity.position.y
  const t = (entity.rotation * Math.PI) / 180
  const lx = dx * Math.cos(t) + dy * Math.sin(t)
  const ly = -dx * Math.sin(t) + dy * Math.cos(t)
  const s = entity.scale ?? 1
  return {
    x: 0.5 + ((entity.flipX ? -1 : 1) * lx) / (size.w * s),
    y: 0.5 + ((entity.flipY ? -1 : 1) * ly) / (size.h * s),
  }
}

/** Half-width of a stroked line entity (walls, paths) in tiles. */
export function lineHalfWidth(entity: MapEntity, sizeOf: AssetSizeOf): number {
  if (entity.toolId === "path") return pathWidth(entity, sizeOf) / 2
  // A roof reaches `width` from its ridge to each eave.
  if (entity.toolId === "roof" && !entity.closed) {
    return typeof entity.params.width === "number" ? entity.params.width : 3
  }
  if (entity.toolId === "wall") {
    // As wide as its texture is tall (see the wall renderer).
    const id = (entity.params.wall as { assets?: string[] } | undefined)?.assets?.[0]
    const h = id ? sizeOf(id)?.h : undefined
    if (h) return h / 2
  }
  return 0.15
}

/**
 * A path's width in tiles: its Width param is a multiplier of its
 * texture's height (1 = as wide as the texture is
 * tall; a tile until the texture's size is known).
 */
export function pathWidth(entity: MapEntity, sizeOf: AssetSizeOf): number {
  const k = typeof entity.params.width === "number" ? entity.params.width : 1
  const asset = typeof entity.params.asset === "string" ? entity.params.asset : undefined
  return k * ((asset && sizeOf(asset)?.h) || 1)
}

/**
 * Whether an entity can be picked/selected. Brush paint (terrain, cave,
 * material, water strokes) is part of the ground and only selectable when
 * `allowPaint` (the Select tool's element filter decides); a Terrain Fill
 * has no shape and never is.
 */
export function isSelectable(entity: MapEntity, allowPaint = false): boolean {
  if (!entity.strokes || entity.points) return true
  // Paint is pickable only by its strokes (a Fill has none), and only when asked.
  return allowPaint && entity.strokes.length > 0
}

/**
 * The entity whose points the Select tool lets you drag: the selection's
 * only item, when it's a polyline/polygon (wall, path, floor, pattern…).
 */
export function editablePointsOf(selected: readonly MapEntity[]): MapEntity | null {
  if (selected.length !== 1) return null
  const [e] = selected
  // A locked one keeps its points as they are.
  return !e.locked && e.points && e.points.length > 0 ? e : null
}

/** Axis-aligned bounds of an entity, for selection boxes and rubber-band selection. */
export function entityBounds(entity: MapEntity, sizeOf: AssetSizeOf): Rect {
  if (entity.strokes && entity.strokes.length > 0) {
    const pts = entity.strokes.flatMap((s) => s.points)
    const r = Math.max(...entity.strokes.map((s) => s.radius))
    return inflate(boundsOf(pts), r)
  }
  if (entity.points && entity.points.length > 0) {
    if (squareEnded(entity)) {
      const half = lineHalfWidth(entity, sizeOf)
      // Bends are rounded off by `half` around the inner points (see squareLineHit).
      const joints = entity.points
        .slice(1, -1)
        .flatMap((v) => [sub(v, { x: half, y: half }), add(v, { x: half, y: half })])
      return boundsOf([...segmentRects(entity.points, half).flat(), ...joints])
    }
    return inflate(boundsOf(entity.points), entity.closed ? 0 : lineHalfWidth(entity, sizeOf))
  }
  return boundsOf(spriteCorners(entity, sizeOf))
}

/**
 * Entities picked only along their outline, never by their interior: a
 * closed wall encloses a room, and clicking inside the room must reach what
 * is in it (furniture, the floor), not the wall around it.
 */
const OUTLINE_ONLY_TOOLS = new Set(["wall", "path"])

/** Whether `p` falls on the entity (hit test used by the Select tool). */
/**
 * Lines drawn with square ends that reach well past their points' line
 * (a path's texture, a manual roof's slopes): picked and boxed by their real
 * footprint, not a capsule that would reach a whole width past each end.
 */
const SQUARE_ENDED_TOOLS = new Set(["path", "roof"])

const squareEnded = (e: MapEntity) =>
  SQUARE_ENDED_TOOLS.has(e.toolId) && !e.closed && (e.points?.length ?? 0) > 1

/** Per segment, the rectangle `half` to each side of it (square ends). */
function segmentRects(points: readonly Vec2[], half: number): Vec2[][] {
  return segmentsOf(points).flatMap(([a, b]) => {
    const len = dist(a, b)
    if (len < 1e-9) return []
    const nx = (-(b.y - a.y) / len) * half
    const ny = ((b.x - a.x) / len) * half
    return [
      [
        { x: a.x + nx, y: a.y + ny },
        { x: b.x + nx, y: b.y + ny },
        { x: b.x - nx, y: b.y - ny },
        { x: a.x - nx, y: a.y - ny },
      ],
    ]
  })
}

/**
 * Whether `p` is on a square-ended line `half` wide each side (plus
 * `tolerance`): inside a segment's rectangle, or around an inner point,
 * where two segments bend.
 */
function squareLineHit(points: readonly Vec2[], p: Vec2, half: number, tolerance: number): boolean {
  if (segmentRects(points, half + tolerance).some((r) => pointInPolygon(p, r))) return true
  return points.slice(1, -1).some((v) => dist(p, v) <= half + tolerance)
}

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
    if (squareEnded(entity)) {
      return squareLineHit(entity.points, p, lineHalfWidth(entity, sizeOf), tolerance)
    }
    return (
      distToPolyline(p, entity.points, entity.closed) <= lineHalfWidth(entity, sizeOf) + tolerance
    )
  }
  if (entity.toolId === "light") return dist(p, entity.position) <= LIGHT_PICK_RADIUS
  return pointInPolygon(p, spriteCorners(entity, sizeOf))
}

/**
 * Topmost entity under `p`: highest draw layer (`drawLayer`) first, then the latest placed
 * within a layer (document order is draw order inside a layer).
 */
export function hitTest(
  entities: readonly MapEntity[],
  p: Vec2,
  sizeOf: AssetSizeOf,
  filter?: (e: MapEntity) => boolean,
  /** Extra reach around lines (walls, paths), in tiles. */
  tolerance?: number,
  /** A finer test after the shape's (e.g. the texture isn't transparent there). */
  solid?: (e: MapEntity, p: Vec2) => boolean,
): MapEntity | undefined {
  let best: { e: MapEntity; i: number; layer: number } | undefined
  entities.forEach((e, i) => {
    if (filter && !filter(e)) return
    if (!entityHit(e, p, sizeOf, tolerance)) return
    if (solid && !solid(e, p)) return
    const layer = drawLayer(e)
    if (!best || layer > best.layer || (layer === best.layer && i > best.i)) best = { e, i, layer }
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
 * openings. Each opening cuts the segment nearest its center; whatever of
 * it sticks out past a corner cuts the neighbouring segment too. Pieces that
 * end on a corner are flagged (`capA`/`capB`) so runs join only there.
 */
export function wallPieces(
  points: readonly Vec2[],
  closed: boolean,
  openings: readonly WallOpening[],
): WallPiece[] {
  const segments = segmentsOf(points, closed)
  const n = segments.length
  const lens = segments.map(([a, b]) => dist(a, b))
  /** Cut intervals per segment, as fractions [t0, t1] of its length. */
  const cuts: [number, number][][] = segments.map(() => [])
  const prevOf = (i: number) => (i > 0 ? i - 1 : closed ? n - 1 : -1)
  const nextOf = (i: number) => (i < n - 1 ? i + 1 : closed ? 0 : -1)
  for (const o of openings) {
    let best = -1
    let bestD = OPENING_TOLERANCE
    let bestT = 0
    segments.forEach(([a, b], i) => {
      if (lens[i] === 0) return
      const { point, t } = closestOnSegment(o.center, a, b)
      const d = dist(point, o.center)
      if (d <= bestD) {
        best = i
        bestD = d
        bestT = t
      }
    })
    if (best < 0) continue
    const half = o.width / 2
    const at = bestT * lens[best]
    cuts[best].push([
      Math.max(0, at - half) / lens[best],
      Math.min(lens[best], at + half) / lens[best],
    ])
    // The part past the segment's ends cuts into the segments around the corners.
    let over = half - at
    for (let i = prevOf(best); over > 1e-9 && i >= 0 && i !== best; i = prevOf(i)) {
      if (lens[i] === 0) continue
      cuts[i].push([Math.max(0, 1 - over / lens[i]), 1])
      over -= lens[i]
    }
    over = at + half - lens[best]
    for (let i = nextOf(best); over > 1e-9 && i >= 0 && i !== best; i = nextOf(i)) {
      if (lens[i] === 0) continue
      cuts[i].push([0, Math.min(1, over / lens[i])])
      over -= lens[i]
    }
  }
  const pieces: WallPiece[] = []
  segments.forEach(([a, b], i) => {
    if (lens[i] === 0) return
    const lerp = (t: number): Vec2 =>
      t >= 1 ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    const cornerStart = closed || i > 0
    const cornerEnd = closed || i < n - 1
    let start = 0
    for (const [t0, t1] of cuts[i].sort((x, y) => x[0] - y[0])) {
      if (t0 > start)
        pieces.push({ a: lerp(start), b: lerp(t0), capA: start === 0 && cornerStart, capB: false })
      start = Math.max(start, t1)
    }
    if (start < 1)
      pieces.push({ a: lerp(start), b, capA: start === 0 && cornerStart, capB: cornerEnd })
  })
  return pieces
}

/** A continuous stretch of wall to draw as one strip (joined corners). */
export interface WallRun {
  points: Vec2[]
  closed: boolean
}

/**
 * Group wall pieces into continuous runs: a piece joins the run before it
 * only when both meet at the same corner (the previous piece reaches it and
 * this one starts there), so the renderer joins their corner. A closed wall
 * without openings stays one closed run; openings split it into open runs
 * (the run crossing the first vertex is stitched back together).
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
  let prev: WallPiece | undefined
  for (const p of pieces) {
    const current = runs[runs.length - 1]
    if (p.capA && current && prev?.capB) current.push(p.b)
    else runs.push([p.a, p.b])
    prev = p
  }
  // A closed wall's first piece continues the last run across vertex 0.
  if (closed && runs.length > 1 && pieces[0].capA && pieces[pieces.length - 1].capB) {
    const first = runs.shift() as Vec2[]
    runs[runs.length - 1].push(...first.slice(1))
  }
  return runs.map((r) => ({ points: r, closed: false }))
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

/** A resize handle: where it sits, the point that stays fixed, and which axes it scales. */
export interface ScaleHandle {
  at: Vec2
  anchor: Vec2
  axis: "both" | "x" | "y"
}

/** Whether a selection can be stretched on one axis (sprites only scale uniformly). */
export function isStretchable(entities: readonly MapEntity[]): boolean {
  return entities.some((e) => !!e.points || !!e.strokes)
}

/**
 * The selection's transform handles: corners (uniform scale anchored at the
 * opposite corner), edge midpoints when `stretchable` (one-axis stretch
 * anchored at the opposite edge), and a rotate handle above the box's
 * top-center. `pxInTiles` is one screen pixel in tiles, so the rotate
 * handle's gap stays constant on screen.
 */
export function transformHandles(
  box: Rect,
  pxInTiles: number,
  stretchable = false,
): { scale: ScaleHandle[]; rotate: Vec2 } {
  const x0 = box.x
  const x1 = box.x + box.w
  const y0 = box.y
  const y1 = box.y + box.h
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const corners = rectPolygon({ x: x0, y: y0 }, { x: x1, y: y1 })
  const scale: ScaleHandle[] = corners.map((at, i) => ({
    at,
    anchor: corners[(i + 2) % 4],
    axis: "both" as const,
  }))
  if (stretchable) {
    scale.push(
      { at: { x: cx, y: y0 }, anchor: { x: cx, y: y1 }, axis: "y" },
      { at: { x: cx, y: y1 }, anchor: { x: cx, y: y0 }, axis: "y" },
      { at: { x: x0, y: cy }, anchor: { x: x1, y: cy }, axis: "x" },
      { at: { x: x1, y: cy }, anchor: { x: x0, y: cy }, axis: "x" },
    )
  }
  return { scale, rotate: { x: cx, y: y0 - ROTATE_HANDLE_GAP_PX * pxInTiles } }
}

/**
 * Scale an entity away from a fixed `anchor` by `sx`/`sy` (map axes). Every
 * coordinate moves; sprite-like entities grow only on a uniform scale
 * (`sx === sy`) since they can't stretch on one axis; brush strokes widen by
 * the smaller factor.
 */
export function scaleEntity(entity: MapEntity, anchor: Vec2, sx: number, sy: number): MapEntity {
  const move = (p: Vec2): Vec2 => ({
    x: anchor.x + (p.x - anchor.x) * sx,
    y: anchor.y + (p.y - anchor.y) * sy,
  })
  const sprite = !entity.points && !entity.strokes
  // A light's size is its Range, not a sprite scale.
  if (entity.toolId === "light") {
    const factor = sx === sy ? sx : 1
    return {
      ...entity,
      position: move(entity.position),
      params: { ...entity.params, range: lightRange(entity) * factor },
    }
  }
  if (entity.toolId === "text") {
    // Its center moves; it grows only on a uniform scale.
    const scaled = { ...entity, scale: sx === sy ? (entity.scale ?? 1) * sx : entity.scale }
    return { ...scaled, position: textAt(scaled, move(textCenter(entity))) }
  }
  return {
    ...entity,
    position: move(entity.position),
    scale: sprite && sx === sy ? (entity.scale ?? 1) * sx : entity.scale,
    points: entity.points?.map(move),
    strokes: entity.strokes?.map((s) => ({
      ...s,
      radius: s.radius * Math.min(sx, sy),
      points: s.points.map(move),
    })),
  }
}

/**
 * Rotate (`screenDegrees`, clockwise on screen) and uniformly scale
 * (`factor`) an entity around `center`. Every coordinate moves and its
 * rotation turns (a shape's is its texture's); sprite-like entities also
 * grow, brush strokes widen. Map x is mirrored, so a
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
  if (entity.toolId === "text") {
    // A text turns and grows about its own center (its position is a corner).
    const turned = {
      ...entity,
      rotation: normalizeDegrees(entity.rotation + screenDegrees),
      scale: (entity.scale ?? 1) * factor,
    }
    return { ...turned, position: textAt(turned, move(textCenter(entity))) }
  }
  return {
    ...entity,
    position: move(entity.position),
    // Shapes turn too: their rotation is their texture's (floors, patterns).
    rotation: normalizeDegrees(entity.rotation + screenDegrees),
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

/**
 * Mirror an entity across the vertical (`"x"`, left↔right on screen) or
 * horizontal (`"y"`, top↔bottom) line through `center`. Every coordinate is
 * reflected and the rotation reversed; sprite-like entities also toggle
 * their own flip, so they look exactly mirrored in place.
 */
export function flipEntity(entity: MapEntity, center: Vec2, axis: "x" | "y"): MapEntity {
  const reflect = (p: Vec2): Vec2 =>
    axis === "x" ? { x: 2 * center.x - p.x, y: p.y } : { x: p.x, y: 2 * center.y - p.y }
  const sprite = !entity.points && !entity.strokes
  if (entity.toolId === "text") {
    // Mirrored in place: its center reflects, its letters stay readable.
    const turned = { ...entity, rotation: normalizeDegrees(-entity.rotation) }
    return { ...turned, position: textAt(turned, reflect(textCenter(entity))) }
  }
  return {
    ...entity,
    position: reflect(entity.position),
    rotation: normalizeDegrees(-entity.rotation),
    flipX: sprite && axis === "x" ? !entity.flipX : entity.flipX,
    flipY: sprite && axis === "y" ? !entity.flipY : entity.flipY,
    points: entity.points?.map(reflect),
    strokes: entity.strokes?.map((s) => ({ ...s, points: s.points.map(reflect) })),
  }
}

/**
 * The points of a circular arc from `start` to `end` that leaves `start`
 * along the direction `prev → start` (tangent to the previous segment), in
 * `segments` pieces — `start` itself excluded, `end` included. A straight
 * segment when there's no direction to follow or `end` lies straight ahead.
 */
export function tangentArc(
  prev: Vec2 | undefined,
  start: Vec2,
  end: Vec2,
  segments: number,
): Vec2[] {
  const len = prev ? dist(prev, start) : 0
  const d = sub(end, start)
  if (!prev || len < 1e-9) return [end]
  const t = { x: (start.x - prev.x) / len, y: (start.y - prev.y) / len }
  const n = { x: -t.y, y: t.x }
  const along = d.x * t.x + d.y * t.y
  const across = d.x * n.x + d.y * n.y
  if (Math.abs(across) < 1e-9) return [end]
  // The circle tangent to t at start through end; the chord–tangent angle
  // is half the arc's sweep.
  const r = (d.x * d.x + d.y * d.y) / (2 * across)
  const center = { x: start.x + n.x * r, y: start.y + n.y * r }
  const sweep = 2 * Math.atan2(across, along)
  const v = sub(start, center)
  const out: Vec2[] = []
  for (let k = 1; k < segments; k++) {
    const a = (sweep * k) / segments
    const c = Math.cos(a)
    const s = Math.sin(a)
    out.push({ x: center.x + v.x * c - v.y * s, y: center.y + v.x * s + v.y * c })
  }
  out.push(end)
  return out
}

/**
 * `a` and `b` joined into one polyline where an end of one meets an end of
 * the other (within `tol`), the shared point kept once; null if no ends meet.
 */
export function joinPolylines(a: readonly Vec2[], b: readonly Vec2[], tol = 1e-6): Vec2[] | null {
  if (a.length === 0 || b.length === 0) return null
  const meet = (p: Vec2, q: Vec2) => dist(p, q) <= tol
  const rb = [...b].reverse()
  if (meet(a[a.length - 1], b[0])) return [...a, ...b.slice(1)]
  if (meet(a[a.length - 1], rb[0])) return [...a, ...rb.slice(1)]
  if (meet(a[0], b[b.length - 1])) return [...b, ...a.slice(1)]
  if (meet(a[0], rb[rb.length - 1])) return [...rb, ...a.slice(1)]
  return null
}

/**
 * The segment of a polyline nearest to `p`: its index (segment i runs from
 * point i to i + 1, the closing one back to point 0), the nearest point on
 * it and how far that is.
 */
export function nearestSegment(
  points: readonly Vec2[],
  p: Vec2,
  closed: boolean,
): { index: number; point: Vec2; dist: number } | null {
  let best: { index: number; point: Vec2; dist: number } | null = null
  segmentsOf(points, closed).forEach(([a, b], index) => {
    const { point } = closestOnSegment(p, a, b)
    const d = dist(point, p)
    if (!best || d < best.dist) best = { index, point, dist: d }
  })
  return best
}
