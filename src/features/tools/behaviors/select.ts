import { useEditorStore } from "../../../stores/editorStore"
import { beginGesture, endGesture, moveEntities, updateEntities } from "../../map/commands"
import {
  dist,
  entityBounds,
  hitTest,
  rectFromCorners,
  rectsIntersect,
  selectionBounds,
  transformEntity,
  transformHandles,
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
interface TransformDrag {
  kind: "scale" | "rotate"
  center: Vec2
  start: Vec2
  /** The selected entities as they were when the drag began. */
  originals: MapEntity[]
}

/** Which transform handle (if any) is under `p` for the current selection. */
export function handleAt(
  ctx: ToolCtx,
  p: Vec2,
  selected: readonly MapEntity[],
): TransformDrag | null {
  const box = selectionBounds(selected, ctx.sizeOf)
  if (!box) return null
  const h = transformHandles(box, screenTiles(1))
  const grab = screenTiles(HANDLE_GRAB_PX)
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const base = { center, start: { x: p.x, y: p.y }, originals: [...selected] }
  if (dist(p, h.rotate) <= grab) return { kind: "rotate", ...base }
  if (h.corners.some((c) => dist(p, c) <= grab)) return { kind: "scale", ...base }
  return null
}

/** Apply a handle drag at pointer `p` (Shift snaps rotation), from the drag's originals. */
export function applyTransformDrag(
  drag: TransformDrag,
  p: Vec2,
  snap: boolean,
): Map<string, MapEntity> {
  let degrees = 0
  let factor = 1
  if (drag.kind === "rotate") {
    const from = screenAngle({ x: drag.start.x - drag.center.x, y: drag.start.y - drag.center.y })
    const to = screenAngle({ x: p.x - drag.center.x, y: p.y - drag.center.y })
    degrees = to - from
    if (snap) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP
  } else {
    const d0 = dist(drag.start, drag.center)
    factor = d0 > 0 ? Math.min(10, Math.max(0.1, dist(p, drag.center) / d0)) : 1
  }
  return new Map(
    drag.originals.map((e) => [e.id, transformEntity(e, drag.center, degrees, factor)]),
  )
}

/** Entities whose bounds intersect the rubber band. */
export function entitiesInRect(ctx: ToolCtx, a: Vec2, b: Vec2): MapEntity[] {
  const band = rectFromCorners(a, b)
  return ctx.entities.filter((e) => rectsIntersect(entityBounds(e, ctx.sizeOf), band))
}

/**
 * Select: click picks the topmost entity (Shift adds/toggles), dragging a
 * selected entity moves the selection (one undo step), dragging empty space
 * rubber-band selects. The selection box's corner handles scale it and the
 * top handle rotates it (Shift snaps to 15°), around its center. `[`/`]`
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
