import { useEditorStore } from "../../../stores/editorStore"
import { type Vec2 } from "../../map/model/types"
import { type ToolBehavior } from "./types"

const show = (a: Vec2, b: Vec2) => useEditorStore.getState().setDraft([{ kind: "measure", a, b }])

/**
 * Measure: drag from one point to another to see the distance (in tiles and
 * feet), snapped like everything else (the Snap toggle). The last measure
 * stays on the map until the next one or another tool is picked.
 */
export function createMeasureBehavior(): ToolBehavior {
  let from: Vec2 | null = null
  return {
    onPointerDown: (ctx, e) => {
      if (e.button !== 0) return
      from = ctx.snap(e, 0.5)
      show(from, from)
    },
    onPointerMove: (ctx, e) => {
      if (from && e.buttons) show(from, ctx.snap(e, 0.5))
    },
    onPointerUp: () => {
      from = null
    },
    onDeactivate: () => {
      from = null
      useEditorStore.getState().setDraft([])
    },
    cursor: () => "crosshair",
  }
}
