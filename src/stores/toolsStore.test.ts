import { beforeEach, describe, expect, it } from "vitest"
import { getToolParams, selectActiveTool, useToolsStore } from "./toolsStore"

const initial = useToolsStore.getState()

beforeEach(() => {
  useToolsStore.setState(initial, true)
})

describe("toolsStore", () => {
  it("materializes defaults when a tool is selected", () => {
    useToolsStore.getState().selectToolById("wall")
    const params = useToolsStore.getState().paramsByTool.wall
    expect(params).toMatchObject({ sorting: "under", shadow: true, bevelCorners: true })
  })

  it("getToolParams resolves defaults for never-selected tools", () => {
    // A tool with params materializes all of them; a param-less tool is empty.
    expect(getToolParams("light")).toMatchObject({ shadow: true, widgets: true, range: 5 })
    expect(getToolParams("select")).toEqual({
      // Lights and floors start filtered out.
      filter: [
        "objects",
        "walls",
        "portals",
        "paths",
        "patterns",
        "roofs",
        "texts",
        "caves",
        "materials",
      ],
      alphaPick: true,
      delete: null,
      duplicate: null,
      copy: null,
      paste: null,
      selectAll: null,
      deselect: null,
      flipH: null,
      flipV: null,
      group: null,
      ungroup: null,
      lock: null,
      unlock: null,
      properties: null,
    })
  })

  it("applies the tool's normalizer within the same update", () => {
    const { selectToolById, setToolParams } = useToolsStore.getState()
    selectToolById("build")
    setToolParams("build", { editPoints: true })
    expect(useToolsStore.getState().paramsByTool.build).toMatchObject({
      editPoints: true,
      shape: null,
    })
  })

  it("starts on Select, and turning a tool off goes back to it", () => {
    useToolsStore.getState().resetAll()
    expect(selectActiveTool(useToolsStore.getState())?.id).toBe("select")
    useToolsStore.getState().selectToolById("wall")
    const top = useToolsStore.getState().path[0]
    useToolsStore.getState().selectTop(top)
    expect(selectActiveTool(useToolsStore.getState())?.id).toBe("select")
  })

  it("toggleParams flips the collapsed flag", () => {
    const { toggleParams } = useToolsStore.getState()
    expect(useToolsStore.getState().paramsCollapsed).toBe(false)
    toggleParams()
    expect(useToolsStore.getState().paramsCollapsed).toBe(true)
    toggleParams()
    expect(useToolsStore.getState().paramsCollapsed).toBe(false)
  })

  it("selecting a different tool re-shows a collapsed params panel", () => {
    const { selectToolById, toggleParams } = useToolsStore.getState()
    selectToolById("wall")
    toggleParams()
    expect(useToolsStore.getState().paramsCollapsed).toBe(true)
    selectToolById("object")
    expect(useToolsStore.getState().paramsCollapsed).toBe(false)
  })
})
