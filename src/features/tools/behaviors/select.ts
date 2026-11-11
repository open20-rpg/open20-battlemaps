import { useEditorStore } from "../../../stores/editorStore"
import { beginGesture, endGesture, moveEntities, updateEntities } from "../../map/commands"
import {
  dist,
  entityBounds,
  hitTest,
  rectFromCorners,
  rectsIntersect,
  isSelectable,
  isStretchable,
  scaleEntity,
  selectionBounds,
  transformEntity,
  transformHandles,
  type ScaleHandle,
} from "../../map/model/geometry"
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
  | { kind: "scale"; handle: ScaleHandle; start: Vec2; originals: MapEntity[] }

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
  return handle ? { kind: "scale", handle, start: handle.at, originals } : null
}

/** Scale factor along one axis: how far the pointer is from the anchor vs. where the handle began. */
const axisFactor = (p: number, start: number, anchor: number) =>
  start === anchor ? 1 : Math.min(10, Math.max(MIN_FACTOR, (p - anchor) / (start - anchor)))

/**
 * Apply a handle drag at pointer `p`, from the drag's originals. Rotation
 * turns around the selection's center (Shift snaps to 15°); scaling keeps
 * the opposite corner/edge fixed, so the selection grows toward the pointer.
 */
export function applyTransformDrag(
  drag: TransformDrag,
  p: Vec2,
  snap: boolean,
): Map<string, MapEntity> {
  if (drag.kind === "rotate") {
    const from = screenAngle({ x: drag.start.x - drag.center.x, y: drag.start.y - drag.center.y })
    const to = screenAngle({ x: p.x - drag.center.x, y: p.y - drag.center.y })
    let degrees = to - from
    if (snap) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP
    return new Map(drag.originals.map((e) => [e.id, transformEntity(e, drag.center, degrees, 1)]))
  }
  const { anchor, axis } = drag.handle
  let sx = 1
  let sy = 1
  if (axis === "both") {
    // Corners scale uniformly: project the pointer on the anchor→corner diagonal.
    const d = { x: drag.start.x - anchor.x, y: drag.start.y - anchor.y }
    const len2 = d.x * d.x + d.y * d.y
    const t = len2 > 0 ? ((p.x - anchor.x) * d.x + (p.y - anchor.y) * d.y) / len2 : 1
    sx = sy = Math.min(10, Math.max(MIN_FACTOR, t))
  } else if (axis === "x") {
    sx = axisFactor(p.x, drag.start.x, anchor.x)
  } else {
    sy = axisFactor(p.y, drag.start.y, anchor.y)
  }
  return new Map(drag.originals.map((e) => [e.id, scaleEntity(e, anchor, sx, sy)]))
}

/** Entities whose bounds intersect the rubber band. */
export function entitiesInRect(ctx: ToolCtx, a: Vec2, b: Vec2): MapEntity[] {
  const band = rectFromCorners(a, b)
  return ctx.entities.filter(
    (e) => isSelectable(e) && rectsIntersect(entityBounds(e, ctx.sizeOf), band),
  )
}

/**
 * Select: click picks the topmost entity (Shift adds/toggles), dragging a
 * selected entity moves the selection (one undo step), dragging empty space
 * rubber-band selects. The selection box's corner handles scale it uniformly
 * and its edge handles (selections with walls, paths, areas…) stretch it,
 * keeping the opposite corner/edge fixed; the top handle rotates it around
 * its center (Shift snaps to 15°). `[`/`]`
 * rotate the selection too; Delete/Ctrl+C/V/X are the global shortcuts.
 */
export function createSelectBehavior(): ToolBehavior {
  let mode:
    | { kind: "move"; from: Vec2; moved: Vec2 }
    | { kind: "band"; from: Vec2; to: Vec2 }
    | { kind: "transform"; drag: TransformDrag }
    | null = null
  const selectedOf = (ctx: ToolCtx) => {
    const ids = new Set(editor().selection)
    return ctx.entities.filter((x) => ids.has(x.id))
  }
  const editor = () => useEditorStore.getState()
  return {
    onPointerDown: (ctx, e) => {
      if (e.button !== 0) return
      // Handles win over whatever is underneath them.
      const drag = handleAt(ctx, e, selectedOf(ctx))
      if (drag) {
        beginGesture()
        mode = { kind: "transform", drag }
        return
      }
      const hit = hitTest(ctx.entities, e, ctx.sizeOf)
      const { selection } = editor()
      if (hit) {
        if (e.shiftKey) {
          editor().toggleSelect([hit.id])
          return
        }
        if (!selection.includes(hit.id)) editor().select([hit.id])
        beginGesture()
        mode = { kind: "move", from: ctx.snap(e, 0.5), moved: { x: 0, y: 0 } }
        return
      }
      if (!e.shiftKey) editor().select([])
      mode = { kind: "band", from: { x: e.x, y: e.y }, to: { x: e.x, y: e.y } }
    },
    onPointerMove: (ctx, e) => {
      if (!mode || !e.buttons) return
      if (mode.kind === "transform") {
        updateEntities(applyTransformDrag(mode.drag, e, e.shiftKey))
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
      if (mode?.kind === "move" || mode?.kind === "transform") endGesture()
      if (mode?.kind === "band") {
        const ids = entitiesInRect(ctx, mode.from, mode.to).map((x) => x.id)
        if (e.shiftKey) editor().toggleSelect(ids)
        else editor().select(ids)
        editor().setDraft([])
      }
      mode = null
    },
    onKeyDown: (ctx, e) => {
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
