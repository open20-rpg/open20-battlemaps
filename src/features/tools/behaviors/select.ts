import { useEditorStore } from "../../../stores/editorStore"
import { beginGesture, endGesture, moveEntities, updateEntities } from "../../map/commands"
import { entityBounds, hitTest, rectFromCorners, rectsIntersect } from "../../map/model/geometry"
import { type MapEntity, type Vec2 } from "../../map/model/types"
import { type ToolBehavior, type ToolCtx } from "./types"

/** Degrees per rotate keypress ([ / ]); Shift for fine steps. */
const ROTATE_STEP = 15

/** Entities whose bounds intersect the rubber band. */
export function entitiesInRect(ctx: ToolCtx, a: Vec2, b: Vec2): MapEntity[] {
  const band = rectFromCorners(a, b)
  return ctx.entities.filter((e) => rectsIntersect(entityBounds(e, ctx.sizeOf), band))
}

/**
 * Select: click picks the topmost entity (Shift adds/toggles), dragging a
 * selected entity moves the selection (one undo step), dragging empty space
 * rubber-band selects. `[`/`]` rotate the selection, Delete/Ctrl+C/V/X are
 * the global shortcuts.
 */
export function createSelectBehavior(): ToolBehavior {
  let mode:
    { kind: "move"; from: Vec2; moved: Vec2 } | { kind: "band"; from: Vec2; to: Vec2 } | null = null
  const editor = () => useEditorStore.getState()
  return {
    onPointerDown: (ctx, e) => {
      if (e.button !== 0) return
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
      if (mode?.kind === "move") endGesture()
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
      if (mode?.kind === "move") endGesture()
      mode = null
      editor().setDraft([])
    },
    cursor: () => "default",
  }
}
