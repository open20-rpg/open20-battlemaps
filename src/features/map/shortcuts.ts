import { useEditorStore } from "../../stores/editorStore"
import { useMapStore } from "../../stores/mapStore"
import { getToolParams, selectActiveTool, useToolsStore } from "../../stores/toolsStore"
import { useViewStore, type ViewToggleKey } from "../../stores/viewStore"
import { APP_ACTIONS, runAppAction } from "../shortcuts/appActions"
import { toggleFullscreen } from "../shortcuts/api"
import { actionForKey, currentBindings } from "../shortcuts/bindings"
import { notifyParamsChange, runToolAction } from "../tools/behaviors"
import { ZOOM_LEVELS } from "../viewport/controls"
import { redo, undo, updateEntities, updateReferenceImage } from "./commands"
import { copySelection, deleteSelection, pasteClipboard, selectAll } from "./clipboard"

/** Quick layer keys (Object, Scatter, Path, Material, Pattern and Select). */
const QUICK_LAYERS: Record<string, number> = {
  "1": 100,
  "Alt+1": -100,
  "2": 200,
  "3": 300,
  "4": 400,
  "Alt+4": -400,
  "7": 700,
  "9": 900,
}
const LAYER_TOOLS = new Set(["object", "scatter", "path", "material", "pattern", "select"])

/** Quick layer key: sets the active tool's Layer, or moves the selection (Select). */
function quickLayer(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return false
  const layer = QUICK_LAYERS[(e.altKey ? "Alt+" : "") + e.key]
  const tool = selectActiveTool(useToolsStore.getState())
  if (layer === undefined || !tool || !LAYER_TOOLS.has(tool.id)) return false
  if (tool.id === "select") {
    const ids = useEditorStore.getState().selection
    updateEntities(new Map(ids.map((id) => [id, { layer }])))
  } else {
    useToolsStore.getState().setToolParams(tool.id, { layer })
  }
  return true
}

/**
 * Editor shortcuts, used when the active tool doesn't handle the key: the
 * fixed ones (clipboard, select all, Escape, quick layers) and every
 * remappable action (features/shortcuts). Returns whether it was consumed.
 */
export function runShortcut(e: KeyboardEvent): boolean {
  if (useMapStore.getState().map) {
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && !e.shiftKey && !e.altKey) {
      if (key === "c") return (copySelection(), true)
      if (key === "x") return (copySelection(), deleteSelection(), true)
      if (key === "v") return (pasteClipboard(), true)
      if (key === "a") return (selectAll(), true)
    }
    if (e.key === "Escape") {
      useEditorStore.getState().select([])
      return true
    }
    if (quickLayer(e)) return true
  }
  const id = actionForKey(e, currentBindings())
  return id ? runAction(id) : false
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

/** The tool X returns to after jumping to Select. */
let toolBeforeSelect: string | null = null

/**
 * Brush size ± `steps` (in the tool's own steps; negative shrinks), or the
 * Object's scale ±0.1 per step. Nothing is written when it's already at the
 * end of its range.
 */
export function nudgeBrush(steps: number): boolean {
  const tool = selectActiveTool(useToolsStore.getState())
  if (!tool) return false
  const params = getToolParams(tool.id)
  const set = (key: string, value: number) => {
    if (params[key] === value) return
    const patch = { [key]: value }
    useToolsStore.getState().setToolParams(tool.id, patch)
    notifyParamsChange(tool.id, patch)
  }
  const spec = tool.params?.find((p) => p.kind === "brushSize")
  if (spec?.kind === "brushSize") {
    const v = typeof params.brushSize === "number" ? params.brushSize : spec.default
    set("brushSize", Math.min(spec.max, Math.max(spec.min, v + steps * spec.step)))
    return true
  }
  if (tool.id === "object") {
    const v = typeof params.scale === "number" ? params.scale : 1
    set("scale", Math.round(Math.min(4, Math.max(0.1, v + steps * 0.1)) * 10) / 10)
    return true
  }
  return false
}

function switchLevel(dir: 1 | -1): boolean {
  const map = useMapStore.getState().map
  const editor = useEditorStore.getState()
  if (!map) return false
  const i = map.levels.findIndex((l) => l.id === editor.activeLevel)
  const next = map.levels[i + dir]
  if (next) editor.setActiveLevel(next.id)
  return true
}

const VIEW_TOGGLES: Record<string, ViewToggleKey> = {
  grid: "grid",
  snap: "snap",
  lighting: "lighting",
  shadows: "shadows",
  outside: "outside",
}

/** Run remappable action `id`; whether it applied. */
export function runAction(id: string): boolean {
  if (APP_ACTIONS.includes(id)) return runAppAction(id)
  if (id.startsWith("tool:")) {
    useToolsStore.getState().selectToolById(id.slice(5))
    return true
  }
  if (VIEW_TOGGLES[id]) {
    useViewStore.getState().toggle(VIEW_TOGGLES[id])
    return true
  }
  if (id === "fullscreen") {
    void toggleFullscreen()
    return true
  }
  const map = useMapStore.getState().map
  if (!map) return false
  const editor = useEditorStore.getState()
  switch (id) {
    case "undo":
      undo()
      return true
    case "redo":
      redo()
      return true
    case "delete":
      deleteSelection()
      return true
    case "flipH":
    case "flipV": {
      // With the Object tool, mirror the object about to be placed.
      if (selectActiveTool(useToolsStore.getState())?.id === "object") {
        const mirror = getToolParams("object").mirror === true
        useToolsStore.getState().setToolParams("object", { mirror: !mirror })
        return true
      }
      runToolAction("select", id)
      return true
    }
    case "group":
    case "ungroup":
    case "lock":
    case "unlock":
      runToolAction("select", id)
      return true
    case "zoomIn":
      stepZoom(1)
      return true
    case "zoomOut":
      stepZoom(-1)
      return true
    case "guide":
      editor.setGuide(editor.guide ? null : editor.pointer)
      return true
    case "reference":
      if (map.referenceImage) updateReferenceImage({ visible: !map.referenceImage.visible })
      return true
    case "compareLevels":
      editor.setCompareLevels(!editor.compareLevels)
      return true
    case "levelUp":
      return switchLevel(1)
    case "levelDown":
      return switchLevel(-1)
    case "brushSmaller":
      return nudgeBrush(-1)
    case "brushBigger":
      return nudgeBrush(1)
    case "selectTool": {
      const tools = useToolsStore.getState()
      const current = selectActiveTool(tools)?.id ?? null
      if (current === "select" && toolBeforeSelect) {
        tools.selectToolById(toolBeforeSelect)
        toolBeforeSelect = null
      } else if (current !== "select") {
        toolBeforeSelect = current
        tools.selectToolById("select")
      }
      return true
    }
  }
  return false
}
