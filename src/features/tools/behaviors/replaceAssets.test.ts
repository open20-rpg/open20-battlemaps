import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useEditorStore } from "../../../stores/editorStore"
import { getToolParams, useToolsStore } from "../../../stores/toolsStore"
import { addEntities, addLevel, closeMap, createMap } from "../../map/commands"
import { type MapEntity } from "../../map/model/types"
import { useMapStore } from "../../../stores/mapStore"
import { assetCache } from "../../map/render/assets"
import { buildToolCtx } from "./context"
import { getToolBehavior } from "./index"

const GONE = "dungeondraft|textures/objects/barrel.png"
const HERE = "pack|textures/objects/tree.png"

const object = (id: string, x: number, asset: string, level?: string): MapEntity => ({
  id,
  toolId: "object",
  layer: 100,
  level,
  position: { x, y: 2 },
  rotation: 0,
  params: { asset },
})

const behavior = () => getToolBehavior("replaceAssets")!
const ctx = () => buildToolCtx("replaceAssets")!
const emphases = () =>
  behavior().overlay!(ctx()).map((s) => (s.kind === "highlight" ? s.emphasis : s.kind))

beforeEach(() => {
  closeMap()
  vi.spyOn(assetCache, "isMissing").mockImplementation((id) => id === GONE)
  createMap(20, 20)
  addEntities([object("a", 2, GONE), object("b", 6, GONE), object("c", 10, HERE)])
  useToolsStore.getState().selectToolById("replaceAssets")
})

afterEach(() => vi.restoreAllMocks())

describe("Replace Assets", () => {
  it("marks every missing use, and the picked asset's current one apart", () => {
    expect(emphases()).toEqual(["dim", "dim"])
    useToolsStore.getState().setToolParams("replaceAssets", { focus: { asset: GONE, index: 1 } })
    expect(emphases()).toEqual(["focus", "current"])
  })

  it("picks the asset of a marked spot clicked on the map", () => {
    behavior().onPointerDown!(ctx(), {
      x: 6,
      y: 2,
      button: 0,
      buttons: 1,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
    })
    expect(getToolParams("replaceAssets").focus).toEqual({ asset: GONE, index: 1 })
  })

  it("shows a use on another level by switching to it", () => {
    addLevel({ id: "L2", name: "Basement" })
    addEntities([object("d", 3, GONE, "L2")])
    behavior().onParamsChange!(ctx(), { focus: { asset: GONE, index: 2 } })
    expect(useEditorStore.getState().activeLevel).toBe("L2")
    expect(useMapStore.getState().map?.entities).toHaveLength(4)
  })
})
