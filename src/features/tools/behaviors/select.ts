import { useEditorStore } from "../../../stores/editorStore"
import { beginGesture, endGesture, moveEntities, updateEntities } from "../../map/commands"
import {
  boundsOf,
  dist,
  editablePointsOf,
  nearestVertex,
  entityBounds,
  hitTest,
  rectFromCorners,
  rectsIntersect,
  flipEntity,
  isStretchable,
  newId,
  scaleEntity,
  selectionBounds,
  transformEntity,
  transformHandles,
  type Rect,
  type ScaleHandle,
} from "../../map/model/geometry"
import { expandGroups, hasGroups } from "../../map/model/groups"
import { elementFilter, selectableBy } from "../selectKinds"
import { screenAngle } from "./structures"
import { screenTiles } from "./shared"
import { type MapEntity, type Vec2 } from "../../map/model/types"
import { type ToolBehavior, type ToolCtx } from "./types"

/** Degrees per rotate keypress ([ / ]); Shift for fine steps. Also the rotate-handle snap with Shift. */
const ROTATE_STEP = 15

/** Grab radius of the transform handles, in screen px. */
const HANDLE_GRAB_PX = 9

/** A scale/rotate drag of the selection's handles. */
type TransformDrag =
  | { kind: "rotate"; center: Vec2; start: Vec2; originals: MapEntity[] }
  | {
      kind: "scale"
      handle: ScaleHandle
      /** Where the grabbed handle was. */
      grab: Vec2
      /**
       * The grabbed side and the fixed side on the selection's geometry
       * (wall/path points, not the box padded by their thickness): what the
       * scale is computed on, so Snap to Grid puts the points on the grid.
       */
      start: Vec2
      anchor: Vec2
      originals: MapEntity[]
    }

/** Smallest scale factor a drag can reach (no collapsing or flipping). */
const MIN_FACTOR = 0.05

/** Which transform handle (if any) is under `p` for the current selection. */
export function handleAt(
  ctx: ToolCtx,
  p: Vec2,
  selected: readonly MapEntity[],
): TransformDrag | null {
  const box = selectionBounds(selected, ctx.sizeOf)
  if (!box) return null
  const h = transformHandles(box, screenTiles(1), isStretchable(selected))
  const grab = screenTiles(HANDLE_GRAB_PX)
  const start = { x: p.x, y: p.y }
  const originals = [...selected]
  if (dist(p, h.rotate) <= grab) {
    const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    return { kind: "rotate", center, start, originals }
  }
  const handle = h.scale.find((s) => dist(p, s.at) <= grab)
  if (!handle) return null
  const inner = geometryBox(selected, box)
  return {
    kind: "scale",
    handle,
    grab: handle.at,
    start: remap(handle.at, box, inner),
    anchor: remap(handle.anchor, box, inner),
    originals,
  }
}

/** The selection's own geometry box: its points when it's all polylines/polygons. */
function geometryBox(selected: readonly MapEntity[], box: Rect): Rect {
  const allPoints = selected.every((e) => (e.points?.length ?? 0) > 0)
  return allPoints ? boundsOf(selected.flatMap((e) => e.points ?? [])) : box
}

/** The point at the same relative place of `to` as `v` is in `from`. */
function remap(v: Vec2, from: Rect, to: Rect): Vec2 {
  const rel = (p: number, o: number, size: number) => (size > 0 ? (p - o) / size : 0.5)
  return {
    x: to.x + rel(v.x, from.x, from.w) * to.w,
    y: to.y + rel(v.y, from.y, from.h) * to.h,
  }
}

/** Scale factor along one axis: how far the pointer is from the anchor vs. where the handle began. */
const axisFactor = (p: number, start: number, anchor: number) =>
  start === anchor ? 1 : Math.min(10, Math.max(MIN_FACTOR, (p - anchor) / (start - anchor)))

/**
 * Apply a handle drag at pointer `p`, from the drag's originals. Rotation
 * turns around the selection's center (Shift snaps to 15°); scaling keeps
 * the opposite corner/edge fixed, so the selection grows toward the pointer.
 * With `toGrid` (Snap to Grid) the dragged side lands on the grid; a corner
 * puts its longer side there.
 */
export function applyTransformDrag(
  drag: TransformDrag,
  p: Vec2,
  snap: boolean,
  toGrid?: (p: Vec2) => Vec2,
): Map<string, MapEntity> {
  if (drag.kind === "rotate") {
    const from = screenAngle({ x: drag.start.x - drag.center.x, y: drag.start.y - drag.center.y })
    const to = screenAngle({ x: p.x - drag.center.x, y: p.y - drag.center.y })
    let degrees = to - from
    if (snap) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP
    return new Map(drag.originals.map((e) => [e.id, transformEntity(e, drag.center, degrees, 1)]))
  }
  const { axis } = drag.handle
  const { anchor, start } = drag
  // Where the grabbed side goes: it follows the pointer from where it was.
  const moved = { x: start.x + p.x - drag.grab.x, y: start.y + p.y - drag.grab.y }
  const target = toGrid ? toGrid(moved) : moved
  let sx = 1
  let sy = 1
  if (axis === "both") {
    // Corners scale uniformly: project on the anchor→corner diagonal, or
    // (on the grid) follow the longer side so it lands on a grid line.
    const d = { x: start.x - anchor.x, y: start.y - anchor.y }
    const len2 = d.x * d.x + d.y * d.y
    let t = len2 > 0 ? ((target.x - anchor.x) * d.x + (target.y - anchor.y) * d.y) / len2 : 1
    if (toGrid && len2 > 0) {
      t = Math.abs(d.x) >= Math.abs(d.y) ? (target.x - anchor.x) / d.x : (target.y - anchor.y) / d.y
    }
    sx = sy = Math.min(10, Math.max(MIN_FACTOR, t))
  } else if (axis === "x") {
    sx = axisFactor(target.x, start.x, anchor.x)
  } else {
    sy = axisFactor(target.y, start.y, anchor.y)
  }
  return new Map(drag.originals.map((e) => [e.id, scaleEntity(e, anchor, sx, sy)]))
}

/**
 * Mirror the selection across its own center (left↔right for `"x"`,
 * top↔bottom for `"y"`): positions reflect, sprites flip in place.
 */
export function flipSelection(ctx: ToolCtx, axis: "x" | "y"): void {
  const ids = new Set(useEditorStore.getState().selection)
  const selected = ctx.entities.filter((e) => ids.has(e.id))
  const box = selectionBounds(selected, ctx.sizeOf)
  if (!box) return
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  updateEntities(new Map(selected.map((e) => [e.id, flipEntity(e, center, axis)])))
}

/** Join the selection into one group (replacing any groups it had). */
export function groupSelection(ctx: ToolCtx): void {
  const ids = new Set(useEditorStore.getState().selection)
  const selected = ctx.entities.filter((e) => ids.has(e.id))
  if (selected.length < 2) return
  const group = newId()
  updateEntities(new Map(selected.map((e) => [e.id, { group }])))
}

/** Dissolve the groups of the selection; the members stay selected. */
export function ungroupSelection(ctx: ToolCtx): void {
  const ids = new Set(useEditorStore.getState().selection)
  const grouped = ctx.entities.filter((e) => ids.has(e.id) && e.group)
  if (grouped.length === 0) return
  updateEntities(new Map(grouped.map((e) => [e.id, { group: undefined }])))
}

/** What clicks and rubber bands may pick: the Select tool's element filter. */
const pickable = (ctx: ToolCtx) => selectableBy(elementFilter(ctx.params))

/** Entities whose bounds intersect the rubber band. */
export function entitiesInRect(ctx: ToolCtx, a: Vec2, b: Vec2): MapEntity[] {
  const band = rectFromCorners(a, b)
  return ctx.entities.filter(
    (e) => pickable(ctx)(e) && rectsIntersect(entityBounds(e, ctx.sizeOf), band),
  )
}

/**
 * Select: click picks the topmost entity (Shift adds/toggles), dragging a
 * selected entity moves the selection (one undo step), dragging empty space
 * rubber-band selects. The selection box's corner handles scale it uniformly
 * and its edge handles (selections with walls, paths, areas…) stretch it,
 * keeping the opposite corner/edge fixed; the top handle rotates it around
 * its center (Shift snaps to 15°). H / V (or the panel buttons) mirror the
 * selection left↔right / top↔bottom. `[`/`]`
 * rotate the selection too; Delete/Ctrl+C/V/X are the global shortcuts.
 */
export function createSelectBehavior(): ToolBehavior {
  let mode:
    | { kind: "move"; from: Vec2; moved: Vec2 }
    | { kind: "band"; from: Vec2; to: Vec2 }
    | { kind: "transform"; drag: TransformDrag }
    | { kind: "vertex"; id: string; index: number }
    | null = null
  const selectedOf = (ctx: ToolCtx) => {
    const ids = new Set(editor().selection)
    return ctx.entities.filter((x) => ids.has(x.id))
  }
  const editor = () => useEditorStore.getState()
  return {
    onPointerDown: (ctx, e) => {
      if (e.button !== 0) return
      // A lone wall/path/area shows its points: dragging one moves just it.
      const editable = editablePointsOf(selectedOf(ctx))
      const index = editable && nearestVertex(editable.points ?? [], e, screenTiles(8))
      if (editable && index !== null && index !== undefined) {
        beginGesture()
        mode = { kind: "vertex", id: editable.id, index }
        return
      }
      // Handles win over whatever is underneath them.
      const drag = handleAt(ctx, e, selectedOf(ctx))
      if (drag) {
        beginGesture()
        mode = { kind: "transform", drag }
        return
      }
      const hit = hitTest(ctx.entities, e, ctx.sizeOf, pickable(ctx))
      const { selection } = editor()
      if (hit) {
        // A group member picks the whole group.
        const picked = expandGroups([hit.id], ctx.entities)
        if (e.shiftKey) {
          editor().toggleSelect(picked)
          return
        }
        if (!selection.includes(hit.id)) editor().select(picked)
        beginGesture()
        mode = { kind: "move", from: ctx.snap(e, 0.5), moved: { x: 0, y: 0 } }
        return
      }
      if (!e.shiftKey) editor().select([])
      mode = { kind: "band", from: { x: e.x, y: e.y }, to: { x: e.x, y: e.y } }
    },
    onPointerMove: (ctx, e) => {
      if (!mode || !e.buttons) return
      if (mode.kind === "vertex") {
        const { id, index } = mode
        const entity = ctx.entities.find((x) => x.id === id)
        if (!entity?.points) return
        const points = entity.points.slice()
        points[index] = ctx.snap(e, 0.5)
        updateEntities(new Map([[id, { points }]]))
        return
      }
      if (mode.kind === "transform") {
        // Scaling follows Snap to Grid like moving does; rotation snaps with Shift.
        const toGrid = ctx.snapEnabled ? (p: Vec2) => ctx.snap(p, 0.5) : undefined
        updateEntities(applyTransformDrag(mode.drag, e, e.shiftKey, toGrid))
        return
      }
      if (mode.kind === "move") {
        const p = ctx.snap(e, 0.5)
        const total = { x: p.x - mode.from.x, y: p.y - mode.from.y }
        const step = { x: total.x - mode.moved.x, y: total.y - mode.moved.y }
        moveEntities(editor().selection, step)
        mode.moved = total
      } else {
        mode.to = { x: e.x, y: e.y }
        editor().setDraft([{ kind: "rect", a: mode.from, b: mode.to }])
      }
    },
    onPointerUp: (ctx, e) => {
      if (mode?.kind === "move" || mode?.kind === "transform" || mode?.kind === "vertex")
        endGesture()
      if (mode?.kind === "band") {
        const ids = expandGroups(
          entitiesInRect(ctx, mode.from, mode.to).map((x) => x.id),
          ctx.entities,
        )
        if (e.shiftKey) editor().toggleSelect(ids)
        else editor().select(ids)
        editor().setDraft([])
      }
      mode = null
    },
    onAction: (ctx, action) => {
      if (action === "flipH") flipSelection(ctx, "x")
      if (action === "flipV") flipSelection(ctx, "y")
      if (action === "group") groupSelection(ctx)
      if (action === "ungroup") ungroupSelection(ctx)
    },
    isActionDisabled: (ctx, action) => {
      const selected = selectedOf(ctx)
      if (action === "group") return selected.length < 2
      if (action === "ungroup") return !hasGroups(selected)
      return selected.length === 0
    },
    onKeyDown: (ctx, e) => {
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === "g") {
        if (e.shiftKey) ungroupSelection(ctx)
        else groupSelection(ctx)
        return true
      }
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        (key === "h" || key === "v") &&
        editor().selection.length > 0
      ) {
        flipSelection(ctx, key === "h" ? "x" : "y")
        return true
      }
      if (e.key !== "[" && e.key !== "]") return false
      const ids = new Set(editor().selection)
      if (ids.size === 0) return false
      const delta = (e.key === "]" ? 1 : -1) * (e.shiftKey ? 1 : ROTATE_STEP)
      const patches = new Map(
        ctx.entities
          .filter((x) => ids.has(x.id) && !x.points && !x.strokes)
          .map((x) => [
            x.id,
            { rotation: ((((x.rotation + delta + 180) % 360) + 360) % 360) - 180 },
          ]),
      )
      updateEntities(patches)
      return true
    },
    onDeactivate: () => {
      if (mode?.kind === "move" || mode?.kind === "transform") endGesture()
      mode = null
      editor().setDraft([])
    },
    cursor: () => "default",
  }
}
