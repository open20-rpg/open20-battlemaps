import { matchesShortcut } from "../../lib/shortcuts"
import { useEditorStore } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { useToolsStore } from "../../stores/toolsStore"
import { useViewStore } from "../../stores/viewStore"
import { TOOL_BY_ID } from "../tools/definitions"
import { VIEW_CONTROLS, ZOOM_LEVELS } from "../viewport/controls"
import { addEntities, redo, removeEntities, undo } from "./commands"
import { isSelectable, newId, translateEntity } from "./model/geometry"
import { regroup } from "./model/groups"

/** Pasted copies land offset by this much (tiles) so they don't hide the originals. */
const PASTE_OFFSET = 1

/** Entities on the active level. */
function levelEntities() {
  const map = useMapStore.getState().map
  const level = useEditorStore.getState().activeLevel
  return map?.entities.filter((e) => !e.level || e.level === level) ?? []
}

export function copySelection(): void {
  const { selection, setClipboard } = useEditorStore.getState()
  const ids = new Set(selection)
  setClipboard(levelEntities().filter((e) => ids.has(e.id)))
}

export function pasteClipboard(): void {
  const { clipboard, activeLevel, select } = useEditorStore.getState()
  if (clipboard.length === 0) return
  const copies = regroup(clipboard).map((e) => ({
    ...translateEntity(e, { x: -PASTE_OFFSET, y: PASTE_OFFSET }),
    id: newId(),
    level: activeLevel ?? e.level,
  }))
  addEntities(copies)
  select(copies.map((e) => e.id))
  // Pasting again offsets from the new copies.
  useEditorStore.getState().setClipboard(copies)
}

export function deleteSelection(): void {
  removeEntities(useEditorStore.getState().selection)
}

/**
 * Global editor shortcuts, used when the active tool doesn't handle the key.
 * Returns whether the key was consumed.
 */
export function runShortcut(e: KeyboardEvent): boolean {
  if (!useMapStore.getState().map) return false
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  if (mod && key === "z" && !e.shiftKey) undo()
  else if (mod && (key === "y" || (key === "z" && e.shiftKey))) redo()
  else if (mod && key === "c") copySelection()
  else if (mod && key === "x") {
    copySelection()
    deleteSelection()
  } else if (mod && key === "v") pasteClipboard()
  else if (mod && key === "a") {
    useEditorStore.getState().select(
      levelEntities()
        .filter(isSelectable)
        .map((x) => x.id),
    )
  } else if (!mod && (e.key === "Delete" || e.key === "Backspace")) deleteSelection()
  else if (e.key === "Escape") useEditorStore.getState().select([])
  else if (!mod && (e.key === "+" || e.key === "=")) stepZoom(1)
  else if (!mod && e.key === "-") stepZoom(-1)
  else return runKeyShortcut(e)
  return true
}

/** The next/previous preset zoom level from the current zoom. */
export function nextZoom(zoom: number, dir: 1 | -1): number {
  const next =
    dir > 0 ? ZOOM_LEVELS.find((z) => z > zoom) : [...ZOOM_LEVELS].reverse().find((z) => z < zoom)
  return next ?? zoom
}

function stepZoom(dir: 1 | -1): void {
  const view = useViewStore.getState()
  view.setZoom(nextZoom(view.zoom, dir))
}

/** Tool and view-toggle keys, declared on their data (TOOL_TREE, VIEW_CONTROLS). */
function runKeyShortcut(e: KeyboardEvent): boolean {
  for (const tool of TOOL_BY_ID.values()) {
    if (tool.shortcut && matchesShortcut(e, tool.shortcut)) {
      useToolsStore.getState().selectToolById(tool.id)
      return true
    }
  }
  for (const control of VIEW_CONTROLS) {
    if (control.kind === "toggle" && control.shortcut && matchesShortcut(e, control.shortcut)) {
      useViewStore.getState().toggle(control.key)
      return true
    }
  }
  return false
}
