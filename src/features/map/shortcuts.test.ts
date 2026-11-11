import { beforeEach, describe, expect, it } from "vitest"
import { useToolsStore } from "../../stores/toolsStore"
import { useViewStore } from "../../stores/viewStore"
import { TOOL_BY_ID } from "../tools/definitions"
import { VIEW_CONTROLS } from "../viewport/controls"
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

beforeEach(() => {
  closeMap()
  createMap(10, 10)
})

describe("keyboard shortcuts", () => {
  it("selects tools by their declared key", () => {
    expect(press("w")).toBe(true)
    expect(useToolsStore.getState().path.at(-1)?.id).toBe("wall")
    press("s")
    expect(useToolsStore.getState().path.at(-1)?.id).toBe("select")
  })

  it("toggles view controls with Shift + key", () => {
    useViewStore.setState({ snap: true, grid: true })
    press("S", { shiftKey: true })
    expect(useViewStore.getState().snap).toBe(false)
    press("G", { shiftKey: true })
    expect(useViewStore.getState().grid).toBe(false)
  })

  it("steps through the zoom presets", () => {
    expect(nextZoom(100, 1)).toBe(125)
    expect(nextZoom(100, -1)).toBe(75)
    expect(nextZoom(110, -1)).toBe(100)
    expect(nextZoom(800, 1)).toBe(800)
  })

  it("declares no key twice", () => {
    const keys = [
      ...[...TOOL_BY_ID.values()].flatMap((t) => (t.shortcut ? [t.shortcut] : [])),
      ...VIEW_CONTROLS.flatMap((c) => (c.kind === "toggle" && c.shortcut ? [c.shortcut] : [])),
    ].map((s) => `${s.shift ? "shift+" : ""}${s.key}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
