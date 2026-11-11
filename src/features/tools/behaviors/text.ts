import { useEditorStore, type TextEditState } from "../../../stores/editorStore"
import { getToolParams } from "../../../stores/toolsStore"
import { useMapStore } from "../../../stores/mapStore"
import {
  addEntities,
  beginGesture,
  endGesture,
  moveEntities,
  removeEntities,
  updateEntity,
} from "../../map/commands"
import { entityHit, newId } from "../../map/model/geometry"
import { type MapEntity, type Vec2 } from "../../map/model/types"
import { type ToolBehavior, type ToolCtx } from "./types"

const hitText = (ctx: ToolCtx, p: Vec2) =>
  [...ctx.entities].reverse().find((e) => e.toolId === "text" && entityHit(e, p, ctx.sizeOf))

/** What a label takes from the tool: its font and its box. */
const TEXT_KEYS = [
  "font",
  "fontSize",
  "fontColor",
  "boxShape",
  "boxBorderWidth",
  "boxColor",
  "boxBorderColor",
] as const

const textParams = (params: Record<string, unknown>) =>
  Object.fromEntries(TEXT_KEYS.map((k) => [k, params[k]]))

/** Apply the open inline editor: create/update the label (one line; empty deletes it). */
export function commitTextEdit(): void {
  const editor = useEditorStore.getState()
  const edit = editor.textEdit
  if (!edit) return
  editor.setTextEdit(null)
  const value = edit.value.replace(/\s*\n\s*/g, " ").trim()
  if (edit.entityId) {
    if (value) updateEntity(edit.entityId, { text: value })
    else removeEntities([edit.entityId])
    return
  }
  if (!value) return
  const map = useMapStore.getState().map
  if (!map) return
  const params = getToolParams("text")
  const entity: MapEntity = {
    id: newId(),
    toolId: "text",
    layer: 900,
    level: editor.activeLevel ?? map.levels[0].id,
    position: edit.position,
    rotation: 0,
    text: value,
    params: textParams(params),
  }
  addEntities([entity])
  editor.select([entity.id])
}

export function cancelTextEdit(): void {
  useEditorStore.getState().setTextEdit(null)
}

/**
 * Text: in Edit mode, click empty map to type a new label there (the click is
 * its top-left corner) or click a label
 * to edit it; in Move mode, drag labels around. The clicked label is
 * selected, which is what the Delete button removes. Font params apply to
 * the selected label as they change.
 */
export function createTextBehavior(): ToolBehavior {
  let dragging: Vec2 | null = null
  let pendingEdit: TextEditState | null = null
  return {
    onPointerDown: (ctx, e) => {
      if (e.button !== 0) return
      if (useEditorStore.getState().textEdit) commitTextEdit()
      const hit = hitText(ctx, e)
      const editor = useEditorStore.getState()
      if (ctx.params.mode === "move") {
        if (!hit) return editor.select([])
        editor.select([hit.id])
        beginGesture()
        dragging = ctx.snap(e, 0.5)
        return
      }
      // The editor opens on release: opening it on press would let the
      // press's own default focus handling blur (and so commit) it at once.
      pendingEdit = hit
        ? { entityId: hit.id, position: hit.position, value: hit.text ?? "" }
        : { entityId: null, position: ctx.snap(e, 0.5), value: "" }
      editor.select(hit ? [hit.id] : [])
    },
    onPointerMove: (ctx, e) => {
      if (!dragging || !e.buttons) return
      const p = ctx.snap(e, 0.5)
      moveEntities(useEditorStore.getState().selection, {
        x: p.x - dragging.x,
        y: p.y - dragging.y,
      })
      dragging = p
    },
    onPointerUp: () => {
      if (pendingEdit) useEditorStore.getState().setTextEdit(pendingEdit)
      pendingEdit = null
      if (dragging) endGesture()
      dragging = null
    },
    onParamsChange: (ctx, patch) => {
      // Font params edit the selected label (like Dungeondraft's text panel).
      if (!TEXT_KEYS.some((k) => k in patch)) return
      const ids = new Set(useEditorStore.getState().selection)
      for (const e of ctx.entities) {
        if (e.toolId === "text" && ids.has(e.id))
          updateEntity(e.id, { params: textParams(ctx.params) })
      }
    },
    onAction: (ctx, action) => {
      if (action !== "delete") return
      const ids = new Set(useEditorStore.getState().selection)
      removeEntities(
        ctx.entities.filter((e) => e.toolId === "text" && ids.has(e.id)).map((e) => e.id),
      )
    },
    isActionDisabled: (ctx, action) => {
      if (action !== "delete") return false
      const ids = new Set(useEditorStore.getState().selection)
      return !ctx.entities.some((e) => e.toolId === "text" && ids.has(e.id))
    },
    onDeactivate: () => {
      commitTextEdit()
      if (dragging) endGesture()
      dragging = null
    },
    cursor: (params) => (params.mode === "move" ? "move" : "text"),
  }
}
