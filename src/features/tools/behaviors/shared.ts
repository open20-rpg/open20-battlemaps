import { useEditorStore, type DraftShape } from "../../../stores/editorStore"
import { useToolsStore } from "../../../stores/toolsStore"
import { useViewStore } from "../../../stores/viewStore"
import { isHeld, isKeyHeld } from "../../shortcuts/held"
import {
  addEntity,
  beginGesture,
  endGesture,
  updateEntities,
  updateEntity,
} from "../../map/commands"
import {
  appendSample,
  dist,
  lineHalfWidth,
  nearestSegment,
  ellipsePolygon,
  nearestVertex,
  rectPolygon,
  tangentArc,
} from "../../map/model/geometry"
import { insertVertexPatches, vertexPatches } from "../../map/model/links"
import { type MapEntity, type Vec2 } from "../../map/model/types"
import { newId } from "../../map/model/geometry"
import { tileSizeForZoom } from "../../map/render/viewport"
import { type Shape } from "../params"
import { type PointerInfo, type ToolBehavior, type ToolCtx } from "./types"

/**
 * Reusable interaction controllers. Each one is a set of ToolBehavior
 * handlers driving a common gesture (click out a polyline, drag a shape,
 * paint a brush stroke, drag vertices), parameterized by what to commit.
 * Their in-progress state lives in module closures and is mirrored to the
 * editor store's draft so the overlay can draw it.
 */

const setDraft = (draft: DraftShape[]) => useEditorStore.getState().setDraft(draft)

/** A distance of `px` screen pixels in tiles at the current zoom. */
export function screenTiles(px: number): number {
  return px / tileSizeForZoom(useViewStore.getState().zoom)
}

/** Fill the fields every new entity needs (id, level, defaults). */
export function makeEntity(
  ctx: ToolCtx,
  fields: Partial<MapEntity> & Pick<MapEntity, "layer">,
): MapEntity {
  return {
    id: newId(),
    toolId: ctx.toolId,
    level: ctx.level,
    position: { x: 0, y: 0 },
    rotation: 0,
    params: {},
    ...fields,
  }
}

const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback)

/** Drop consecutive duplicates (a double-click adds the same point twice). */
export function dedupe(points: Vec2[]): Vec2[] {
  return points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 1e-6)
}

// -- polyline ----------------------------------------------------------------

/** Modifiers held when a polyline was finished. */
export interface FinishMods {
  ctrlKey: boolean
}

/** Arc pieces of a Shift+click (the wheel changes it while drawing one). */
export const ARC_SEGMENTS = { default: 8, min: 2, max: 32 } as const

export interface PolylineOptions {
  /** Minimum vertices for a valid result (2 for lines, 3 for polygons). */
  minPoints: number
  /** Whether the result is a closed polygon. */
  closed: boolean
  /** Snap step in tiles (grid corners by default). */
  step?: number
  /** `mods.ctrlKey`: Ctrl was held when finishing (Wall joins existing walls). */
  commit: (ctx: ToolCtx, points: Vec2[], mods: FinishMods) => void
  /**
   * The entities that `commit` would create from these points, drawn
   * semi-transparent by their real renderers while the shape is still being
   * drawn (pending points plus the hovered one).
   */
  preview?: (ctx: ToolCtx, points: Vec2[]) => MapEntity[]
}

/** Draft ghosts for a preview function, when there are enough points to build anything. */
function ghosts(
  ctx: ToolCtx,
  points: Vec2[],
  minPoints: number,
  preview?: (ctx: ToolCtx, points: Vec2[]) => MapEntity[],
): DraftShape[] {
  const pts = dedupe(points)
  if (!preview || pts.length < minPoints) return []
  return preview(ctx, pts).map((entity) => ({ kind: "ghost" as const, entity }))
}

/**
 * Click to add vertices; double-click, Enter or right-click finishes
 * (clicking the first vertex also closes a polygon); Backspace removes the
 * last vertex; Escape cancels. Shift+click adds an arc tangent to the last
 * segment (Shift+wheel: more/fewer pieces), as in Dungeondraft; Shift+click
 * on the first vertex closes a polygon with one.
 */
export function polylineController(
  opts: PolylineOptions,
): Required<
  Pick<
    ToolBehavior,
    "onPointerDown" | "onPointerMove" | "onDoubleClick" | "onKeyDown" | "onDeactivate" | "onWheel"
  >
> {
  let points: Vec2[] = []
  /** How many points each click added (an arc adds several): what Backspace undoes. */
  let added: number[] = []
  let hover: Vec2 | null = null
  let arcHover = false
  let arcSegments: number = ARC_SEGMENTS.default
  /** The points a click at `p` adds: `p`, or (arc) the arc to it. */
  const toward = (p: Vec2, arc: boolean): Vec2[] =>
    arc && points.length > 0
      ? tangentArc(points.at(-2), points[points.length - 1], p, arcSegments)
      : [p]
  const show = (ctx: ToolCtx) => {
    const pts = hover ? [...points, ...toward(hover, arcHover)] : points
    setDraft(
      points.length > 0
        ? [
            ...(opts.closed && isHeld("invert")
              ? []
              : ghosts(ctx, pts, opts.minPoints, opts.preview)),
            { kind: "polyline", points: pts, closed: opts.closed && pts.length > 2 },
          ]
        : [],
    )
  }
  const cancel = () => {
    points = []
    added = []
    hover = null
    setDraft([])
  }
  const finish = (ctx: ToolCtx, mods: FinishMods = { ctrlKey: false }) => {
    const pts = dedupe(points)
    cancel()
    if (pts.length >= opts.minPoints) opts.commit(ctx, pts, mods)
  }
  const push = (pts: Vec2[]) => {
    points = [...points, ...pts]
    added = [...added, pts.length]
  }
  return {
    onPointerDown: (ctx, e) => {
      if (e.button === 2) {
        finish(ctx, e)
        return
      }
      const p = ctx.snap(e, opts.step ?? 1)
      if (opts.closed && points.length >= opts.minPoints && dist(p, points[0]) < screenTiles(10)) {
        // The closing arc ends on the first vertex, which is already there.
        if (e.shiftKey) push(toward(points[0], true).slice(0, -1))
        finish(ctx, e)
        return
      }
      push(toward(p, e.shiftKey))
      show(ctx)
    },
    onPointerMove: (ctx, e) => {
      hover = ctx.snap(e, opts.step ?? 1)
      arcHover = e.shiftKey
      if (points.length > 0) show(ctx)
    },
    onWheel: (ctx, e) => {
      if (!e.shiftKey || points.length === 0) return false
      arcSegments = Math.min(ARC_SEGMENTS.max, Math.max(ARC_SEGMENTS.min, arcSegments + e.dir))
      arcHover = true
      show(ctx)
      return true
    },
    onDoubleClick: (ctx, e) => finish(ctx, e),
    onKeyDown: (ctx, e) => {
      if (points.length === 0) return false
      if (e.key === "Enter") finish(ctx, e)
      else if (e.key === "Escape") cancel()
      else if (e.key === "Backspace" || e.key === "Delete") {
        points = points.slice(0, points.length - (added.at(-1) ?? 1))
        added = added.slice(0, -1)
        show(ctx)
      } else return false
      return true
    },
    onDeactivate: (ctx) => finish(ctx),
  }
}

// -- shapes ------------------------------------------------------------------

/** Polygon for a dragged shape (rectangle/ellipse) between two corners. */
export function shapePolygon(shape: Shape | null, a: Vec2, b: Vec2): Vec2[] {
  return shape === "ellipse" ? ellipsePolygon(a, b) : rectPolygon(a, b)
}

/**
 * Drag out a rectangle/ellipse (`shape` param) or, for the "path" shape,
 * click out a polygon. Commits the resulting closed polygon.
 */
export function shapeController(
  commit: (ctx: ToolCtx, polygon: Vec2[]) => void,
  /** Entities `commit` would create from the polygon (live preview while dragging). */
  preview?: (ctx: ToolCtx, polygon: Vec2[]) => MapEntity[],
): Required<
  Pick<
    ToolBehavior,
    | "onPointerDown"
    | "onPointerMove"
    | "onPointerUp"
    | "onDoubleClick"
    | "onKeyDown"
    | "onDeactivate"
    | "onWheel"
  >
> {
  const poly = polylineController({ minPoints: 3, closed: true, commit, preview })
  let start: Vec2 | null = null
  let current: Vec2 | null = null
  const shapeOf = (ctx: ToolCtx) => (ctx.params.shape as Shape | null) ?? "rectangle"
  const show = (ctx: ToolCtx) => {
    if (!start || !current) return setDraft([])
    const polygon = shapePolygon(shapeOf(ctx), start, current)
    const degenerate = Math.abs(start.x - current.x) < 1e-6 || Math.abs(start.y - current.y) < 1e-6
    // While Alt cuts (Build, Pattern, Water) there's nothing to add: just the outline.
    setDraft([
      ...(degenerate || isHeld("invert") ? [] : ghosts(ctx, polygon, 3, preview)),
      { kind: "polygon", points: polygon },
    ])
  }
  return {
    onPointerDown: (ctx, e) => {
      if (shapeOf(ctx) === "path") return poly.onPointerDown(ctx, e)
      if (e.button !== 0) return
      start = ctx.snap(e)
      current = start
      show(ctx)
    },
    onPointerMove: (ctx, e) => {
      if (shapeOf(ctx) === "path") return poly.onPointerMove(ctx, e)
      if (!start) return
      current = ctx.snap(e)
      show(ctx)
    },
    onPointerUp: (ctx) => {
      if (shapeOf(ctx) === "path" || !start || !current) return
      const a = start
      const b = current
      start = current = null
      setDraft([])
      if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) {
        commit(ctx, shapePolygon(shapeOf(ctx), a, b))
      }
    },
    onDoubleClick: (ctx, e) => {
      if (shapeOf(ctx) === "path") poly.onDoubleClick(ctx, e)
    },
    onWheel: (ctx, e) => shapeOf(ctx) === "path" && poly.onWheel(ctx, e),
    onKeyDown: (ctx, e) => {
      if (shapeOf(ctx) === "path") return poly.onKeyDown(ctx, e)
      if (e.key === "Escape" && start) {
        start = current = null
        setDraft([])
        return true
      }
      return false
    },
    onDeactivate: (ctx) => {
      poly.onDeactivate(ctx)
      start = current = null
      setDraft([])
    },
  }
}

// -- brush -------------------------------------------------------------------

export interface BrushOptions {
  /** Brush radius in tiles for the current params. */
  radius: (ctx: ToolCtx) => number
  /** Whether this stroke removes area (Alt or right-drag). */
  erase?: (ctx: ToolCtx, e: PointerInfo) => boolean
  /** Whether this stroke paints the cave's blasted area (Cave "Blast Open"). */
  blast?: (ctx: ToolCtx) => boolean
  /** The cursor circle's radius, if not the brush's own (cell-stamp brushes). */
  cursorRadius?: (ctx: ToolCtx) => number
  /** Least distance (tiles) between stroke points; default a quarter of the radius. */
  spacing?: number
  /** Snapshot of params stored on the stroke entity. */
  params: (ctx: ToolCtx) => Record<string, unknown>
  layer: (ctx: ToolCtx) => number
  /** Return false to refuse painting (e.g. no texture slot set). */
  canPaint?: (ctx: ToolCtx) => boolean
}

/** Paint strokes: each press-drag-release is one undoable stroke entity. */
export function brushController(
  opts: BrushOptions,
): Required<
  Pick<ToolBehavior, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onDeactivate">
> {
  let strokeId: string | null = null
  let points: Vec2[] = []
  const cursor = (ctx: ToolCtx, p: Vec2) =>
    setDraft([{ kind: "circle", center: p, radius: (opts.cursorRadius ?? opts.radius)(ctx) }])
  const end = () => {
    if (strokeId) endGesture()
    strokeId = null
    points = []
  }
  return {
    onPointerDown: (ctx, e) => {
      if (opts.canPaint && !opts.canPaint(ctx)) return
      const p = { x: e.x, y: e.y }
      beginGesture()
      const entity = makeEntity(ctx, {
        layer: opts.layer(ctx),
        position: p,
        strokes: [
          {
            points: [p],
            radius: opts.radius(ctx),
            erase: opts.erase?.(ctx, e) || undefined,
            blast: opts.blast?.(ctx) || undefined,
          },
        ],
        params: opts.params(ctx),
      })
      strokeId = entity.id
      points = [p]
      addEntity(entity)
    },
    onPointerMove: (ctx, e) => {
      const p = { x: e.x, y: e.y }
      cursor(ctx, p)
      if (!strokeId || !e.buttons) return
      const radius = opts.radius(ctx)
      const next = appendSample(points, p, opts.spacing ?? Math.max(0.05, radius * 0.25))
      if (next === points) return
      points = next
      const entity = ctx.map.entities.find((x) => x.id === strokeId)
      const stroke = entity?.strokes?.[0]
      if (stroke) updateEntity(strokeId, { strokes: [{ ...stroke, points }] })
    },
    onPointerUp: () => end(),
    onDeactivate: () => {
      end()
      setDraft([])
    },
  }
}

// -- vertex editing ----------------------------------------------------------

/**
 * Edit-points mode: drag existing vertices of entities made by `toolIds`.
 * Shows every editable vertex as a handle; one drag is one undo step.
 */
/** Most time between the two presses of a double tap, in ms. */
const DOUBLE_TAP_MS = 350
/** Farthest apart the two presses of a double tap may land, in screen px. */
const DOUBLE_TAP_PX = 12

/**
 * A double-tap detector fed every press: true on the second press of a
 * quick pair at about the same place. Detected on the press itself (not the
 * browser's dblclick, which fires on release) so the second press can go on
 * to drag.
 */
export function doubleTapDetector(): (p: Vec2) => boolean {
  let last: { t: number; p: Vec2 } | null = null
  return (p) => {
    const now = performance.now()
    const hit =
      !!last && now - last.t < DOUBLE_TAP_MS && dist(last.p, p) < screenTiles(DOUBLE_TAP_PX)
    last = hit ? null : { t: now, p: { x: p.x, y: p.y } }
    return hit
  }
}

/** How far past a line's edge a double tap still adds a point to it, in screen px. */
const INSERT_REACH_PX = 8

/**
 * Add a vertex to `entity`'s line where `p` is, if `p` is on it (within its
 * width plus a few screen px), and to its linked entities too. Opens a
 * gesture (the caller ends it once the new vertex's drag is released) and
 * returns the new vertex's index, or null if `p` is off the line.
 */
export function insertVertexAt(ctx: ToolCtx, entity: MapEntity, p: Vec2): number | null {
  const pts = entity.points ?? []
  if (pts.length < 2) return null
  const seg = nearestSegment(pts, p, !!entity.closed)
  const reach = lineHalfWidth(entity, ctx.sizeOf) + screenTiles(INSERT_REACH_PX)
  if (!seg || seg.dist > reach) return null
  beginGesture()
  updateEntities(insertVertexPatches(entity, seg.index, ctx.snap(p, 0.5), ctx.entities))
  return seg.index + 1
}

/**
 * Remove vertex `index` of `entity` (and the matching one of its linked
 * entities), keeping a usable shape: 2 points for a line, 3 for a polygon.
 * False when it can't go.
 */
export function removeVertex(ctx: ToolCtx, entity: MapEntity, index: number): boolean {
  const points = entity.points ?? []
  if (points.length <= (entity.closed ? 3 : 2)) return false
  updateEntities(vertexPatches(entity, index, null, ctx.entities))
  return true
}

export function editPointsController(
  toolIds: readonly string[],
  step = 1,
): Required<
  Pick<
    ToolBehavior,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onDeactivate" | "onKeyDown"
  >
> & {
  /** Draw the vertex handles (e.g. right when edit mode is turned on). */
  show: (ctx: ToolCtx) => void
} {
  let target: { id: string; index: number } | null = null
  const isDoubleTap = doubleTapDetector()
  /** The last clicked vertex: Delete/Backspace removes it. */
  let selected: { id: string; index: number } | null = null
  const tools = new Set(toolIds)
  const editable = (ctx: ToolCtx) =>
    ctx.entities.filter((e) => tools.has(e.toolId) && e.points && e.points.length > 0)
  // The control line joining each entity's points (a path's raw edit points,
  // before smoothing), then the draggable handles on top.
  const showHandles = (ctx: ToolCtx) => {
    const entities = editable(ctx)
    setDraft([
      ...entities.map((e) => ({
        kind: "polyline" as const,
        points: e.points ?? [],
        closed: !!e.closed,
      })),
      {
        kind: "handles",
        points: entities.flatMap((e) => e.points ?? []),
        active: selectedPoint(ctx),
      },
    ])
  }
  const selectedPoint = (ctx: ToolCtx) =>
    selected ? ctx.entities.find((x) => x.id === selected?.id)?.points?.[selected.index] : undefined
  return {
    show: showHandles,
    onPointerDown: (ctx, e) => {
      const tol = screenTiles(8)
      // Right-click (or a long press on touch) on a point removes it.
      if (e.button === 2) {
        for (const entity of editable(ctx).reverse()) {
          const index = nearestVertex(entity.points ?? [], e, tol)
          if (index === undefined) continue
          removeVertex(ctx, entity, index)
          selected = null
          showHandles(ctx)
          return
        }
        return
      }
      // Fed on every press, so a vertex press doesn't pair with the next one.
      const doubleTap = isDoubleTap(e)
      for (const entity of editable(ctx).reverse()) {
        const index = nearestVertex(entity.points ?? [], e, tol)
        if (index !== undefined) {
          target = { id: entity.id, index }
          selected = target
          beginGesture()
          showHandles(ctx)
          return
        }
      }
      // A double tap on a line adds a point there, already being dragged.
      if (doubleTap) {
        for (const entity of editable(ctx).reverse()) {
          const index = insertVertexAt(ctx, entity, e)
          if (index === null) continue
          target = { id: entity.id, index }
          selected = target
          showHandles(ctx)
          return
        }
      }
      selected = null
      showHandles(ctx)
    },
    onKeyDown: (ctx, e) => {
      if ((e.key !== "Delete" && e.key !== "Backspace") || !selected) return false
      const entity = ctx.entities.find((x) => x.id === selected?.id)
      if (!entity || !removeVertex(ctx, entity, selected.index)) return true
      selected = null
      showHandles(ctx)
      return true
    },
    onPointerMove: (ctx, e) => {
      if (target && e.buttons) {
        const entity = ctx.map.entities.find((x) => x.id === target?.id)
        // A room's floor and wall move the vertex together.
        if (entity?.points)
          updateEntities(vertexPatches(entity, target.index, ctx.snap(e, step), ctx.map.entities))
      }
      showHandles(ctx)
    },
    onPointerUp: () => {
      if (target) endGesture()
      target = null
    },
    onDeactivate: () => {
      if (target) endGesture()
      target = null
      selected = null
      setDraft([])
    },
  }
}

/** Read a numeric param with a fallback. */
export const paramNum = num

/**
 * Nudge a numeric tool param by `delta`, clamped to [min, max] and rounded
 * to `precision` decimals (wheel / key adjustments).
 */
export function nudgeParam(
  ctx: ToolCtx,
  key: string,
  delta: number,
  min: number,
  max: number,
  fallback: number,
  precision = 2,
): void {
  const v = paramNum(ctx.params[key], fallback) + delta
  const f = 10 ** precision
  useToolsStore
    .getState()
    .setToolParams(ctx.toolId, { [key]: Math.round(Math.min(max, Math.max(min, v)) * f) / f })
}

/** Degrees per wheel notch: 15, or 5 while Z is held (Dungeondraft's fine step). */
export const wheelDegrees = (): number => (isKeyHeld("Z") ? 5 : 15)
