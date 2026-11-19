import { useEditorStore, type TextEditState } from "../../../stores/editorStore"
import { getToolParams, useToolsStore } from "../../../stores/toolsStore"
import { useMapStore } from "../../../stores/mapStore"
import { addEntities, removeEntities, updateEntity } from "../../map/commands"
import { textBoxParams } from "../../fonts/metrics"
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
  "box",
  "boxRadius",
  "boxPadTop",
  "boxPadRight",
  "boxPadBottom",
  "boxPadLeft",
  "boxBorderWidth",
  "boxColor",
  "boxBorderColor",
] as const

const textParams = (params: Record<string, unknown>) =>
  Object.fromEntries(TEXT_KEYS.map((k) => [k, params[k]]))

/**
 * Show a label's look in the tool's panel (its font and box), so what the
 * panel shows is what it has. Params set here don't reach onParamsChange.
 */
function showLabel(label: MapEntity): void {
  // Its box as today's params (labels saved before have a box shape instead).
  const params: Record<string, unknown> = { ...label.params, ...textBoxParams(label.params) }
  const own = Object.fromEntries(
    TEXT_KEYS.flatMap((k) => (params[k] === undefined ? [] : [[k, params[k]]])),
  )
  useToolsStore.getState().setToolParams("text", own)
}

/** The lone selected label, if the selection is one (and it isn't locked). */
function selectedLabel(ctx: ToolCtx): MapEntity | undefined {
  const [id, ...rest] = useEditorStore.getState().selection
  if (!id || rest.length) return undefined
  return ctx.entities.find((e) => e.id === id && e.toolId === "text" && !e.locked)
}

/**
 * The inline editor's input (TextEditOverlay keeps one mounted). Phones and
 * tablets only bring up the on-screen keyboard for a focus made while
 * handling the tap itself, so the editor is focused right here, in the
 * pointer handler that opens it, rather than once React has rendered it.
 */
let editorInput: HTMLInputElement | null = null

export function registerTextEditorInput(input: HTMLInputElement | null): void {
  editorInput = input
}

function openTextEdit(edit: TextEditState): void {
  useEditorStore.getState().setTextEdit(edit)
  editorInput?.focus({ preventScroll: true })
}

/** Apply the open inline editor: create/update the label (one line; empty deletes it). */
export function commitTextEdit(): void {
  const editor = useEditorStore.getState()
  const edit = editor.textEdit
  if (!edit) return
  editor.setTextEdit(null)
  // Closes the on-screen keyboard (the input stays mounted, hidden).
  editorInput?.blur()
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
  editorInput?.blur()
}

/**
 * Text: click empty map to type a new label there (where the press is
 * released: its top-left corner) or click a label to edit it. The clicked
 * label is selected and its look shown in the panel; font params apply to
 * it as they change. Moving and deleting labels is the Select tool's (and
 * Delete's) job. Locked labels are left alone.
 */
export function createTextBehavior(): ToolBehavior {
  let pendingEdit: TextEditState | null = null
  return {
    onPointerDown: (ctx, e) => {
      if (e.button !== 0) return
      if (useEditorStore.getState().textEdit) commitTextEdit()
      const hit = hitText(ctx, e)
      // A locked label can't be written in (nor a new one started over it).
      if (hit?.locked) return
      // Its look in the panel: changing one param changes just that.
      if (hit) showLabel(hit)
      // The editor opens on release: opening it on press would let the
      // press's own default focus handling blur (and so commit) it at once.
      pendingEdit = hit
        ? { entityId: hit.id, position: hit.position, value: hit.text ?? "" }
        : { entityId: null, position: ctx.snap(e, 0.5), value: "" }
      useEditorStore.getState().select(hit ? [hit.id] : [])
    },
    onPointerUp: (ctx, e) => {
      // A new label goes where the press is released (touch has no hover).
      if (pendingEdit?.entityId === null) pendingEdit.position = ctx.snap(e, 0.5)
      if (pendingEdit) openTextEdit(pendingEdit)
      pendingEdit = null
    },
    onActivate: (ctx) => {
      const label = selectedLabel(ctx)
      if (label) showLabel(label)
    },
    onParamsChange: (ctx, patch) => {
      // Font params edit the selected labels, like a text panel: only what
      // changed, so each keeps the rest of its own look.
      const changed = Object.fromEntries(
        TEXT_KEYS.flatMap((k) => (k in patch ? [[k, patch[k]]] : [])),
      )
      if (Object.keys(changed).length === 0) return
      const ids = new Set(useEditorStore.getState().selection)
      for (const e of ctx.entities) {
        if (e.toolId === "text" && !e.locked && ids.has(e.id))
          updateEntity(e.id, { params: { ...e.params, ...changed } })
      }
    },
    onDeactivate: () => commitTextEdit(),
    cursor: () => "text",
  }
}
