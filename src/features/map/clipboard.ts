import { useEditorStore } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { getToolParams } from "../../stores/toolsStore"
import { elementFilter, selectableBy } from "../tools/selectKinds"
import { addEntities, removeEntities } from "./commands"
import { newId, translateEntity } from "./model/geometry"
import { regroup } from "./model/groups"

/**
 * Selection actions shared by the keyboard shortcuts and the Select tool's
 * buttons (on touch screens there's no keyboard): copy, paste, duplicate,
 * delete, select all, deselect.
 */

/** Pasted copies land offset by this much (tiles) so they don't hide the originals. */
const PASTE_OFFSET = 1

/** Entities on the active level. */
export function levelEntities() {
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

/** Copy and paste in one go (the clipboard ends up holding the copies). */
export function duplicateSelection(): void {
  copySelection()
  pasteClipboard()
}

export function deleteSelection(): void {
  removeEntities(useEditorStore.getState().selection)
}

/** Everything on the level the Select tool's element filter lets it pick. */
export function selectAll(): void {
  const onLevel = levelEntities()
  const pick = selectableBy(elementFilter(getToolParams("select")), false, onLevel)
  useEditorStore.getState().select(onLevel.filter(pick).map((x) => x.id))
}
