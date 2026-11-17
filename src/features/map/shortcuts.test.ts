import { beforeEach, describe, expect, it } from "vitest"
import { findConflicts } from "../../lib/keybindings"
import { useEditorStore } from "../../stores/editorStore"
import { useSettingsStore } from "../../stores/settingsStore"
import { getToolParams, useToolsStore } from "../../stores/toolsStore"
import { useViewStore } from "../../stores/viewStore"
import { FIXED_CHORDS, PRESET_BINDINGS, effectiveBindings, knownPreset } from "../shortcuts/actions"
import { closeMap, createMap } from "./commands"
import { nextZoom, runShortcut } from "./shortcuts"

// Tests run without a DOM: a plain object with the fields the handler reads.
const press = (key: string, mods: Partial<KeyboardEvent> = {}) =>
  runShortcut({
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  } as KeyboardEvent)
const activeTool = () => useToolsStore.getState().path.at(-1)?.id

beforeEach(() => {
  closeMap()
  createMap(10, 10)
  useSettingsStore.getState().resetShortcuts()
})

describe("keyboard shortcuts (classic preset)", () => {
  it("selects tools; X jumps to Select and back", () => {
    expect(press("w")).toBe(true)
    expect(activeTool()).toBe("wall")
    press("x")
    expect(activeTool()).toBe("select")
    press("x")
    expect(activeTool()).toBe("wall")
  })

  it("toggles view overlays with the preset's keys", () => {
    useViewStore.setState({ snap: true, grid: true, lighting: true })
    press("s")
    expect(useViewStore.getState().snap).toBe(false)
    press("g")
    expect(useViewStore.getState().grid).toBe(false)
    press("l")
    expect(useViewStore.getState().lighting).toBe(false)
  })

  it("zooms with Ctrl+= / Ctrl+- through the presets", () => {
    useViewStore.setState({ zoom: 100 })
    press("=", { ctrlKey: true })
    expect(useViewStore.getState().zoom).toBe(125)
    press("-", { ctrlKey: true })
    expect(useViewStore.getState().zoom).toBe(100)
    expect(nextZoom(800, 1)).toBe(800)
  })

  it("follows the user's changes, and resets them", () => {
    useViewStore.setState({ grid: true })
    useSettingsStore.getState().setShortcutBindings("grid", ["Shift+G"])
    expect(press("g")).toBe(false)
    press("G", { shiftKey: true })
    expect(useViewStore.getState().grid).toBe(false)
    useSettingsStore.getState().resetShortcuts()
    press("g")
    expect(useViewStore.getState().grid).toBe(true)
  })

  it("sets the tool's layer with the quick layer keys", () => {
    useToolsStore.getState().selectToolById("object")
    press("2")
    expect(getToolParams("object").layer).toBe(200)
    press("1", { altKey: true })
    expect(getToolParams("object").layer).toBe(-100)
  })

  it("resizes the brush with { and }", () => {
    useToolsStore.getState().selectToolById("terrainBrush")
    const size = getToolParams("terrainBrush").brushSize as number
    press("}")
    expect(getToolParams("terrainBrush").brushSize).toBe(size + 1)
    press("[")
    expect(getToolParams("terrainBrush").brushSize).toBe(size)
  })

  it("toggles the ruler, compare levels and pins the guide at the pointer", () => {
    useEditorStore.getState().setPointer({ x: 3, y: 4 })
    press("h")
    expect(useEditorStore.getState().guide).toEqual({ x: 3, y: 4 })
    press("r")
    expect(useEditorStore.getState().rulerOn).toBe(true)
    press("c")
    expect(useEditorStore.getState().compareLevels).toBe(true)
  })

  it("has no conflicts in the preset", () => {
    expect([...findConflicts(effectiveBindings("classic", {}), FIXED_CHORDS)]).toEqual([])
    expect(Object.keys(PRESET_BINDINGS.classic).length).toBeGreaterThan(40)
  })
})

describe("saved shortcut preset", () => {
  it("keeps a preset that exists and falls back to the default for a renamed one", () => {
    expect(knownPreset("classic")).toBe("classic")
    expect(knownPreset("dungeondraft")).toBe("classic")
    expect(knownPreset(undefined)).toBe("classic")
  })
})
