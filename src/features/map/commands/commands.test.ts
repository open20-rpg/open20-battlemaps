import { beforeEach, describe, expect, it } from "vitest"
import { useMapStore } from "../../../stores/mapStore"
import {
  addEntity,
  canRedo,
  canUndo,
  closeMap,
  createMap,
  redo,
  removeEntities,
  undo,
} from "./index"
import { type MapEntity } from "../model/types"

const entity = (id: string): MapEntity => ({
  id,
  toolId: "object",
  layer: 100,
  position: { x: 1, y: 2 },
  rotation: 0,
  params: {},
})

beforeEach(() => {
  closeMap()
})

describe("map commands", () => {
  it("createMap clamps dimensions and starts a clean history", () => {
    createMap(10.6, 0)
    expect(useMapStore.getState().map).toEqual({ width: 11, height: 1, entities: [] })
    expect(canUndo()).toBe(false)
  })

  it("addEntity/removeEntities mutate the document", () => {
    createMap(10, 10)
    addEntity(entity("a"))
    addEntity(entity("b"))
    removeEntities(["a"])
    expect(useMapStore.getState().map?.entities.map((e) => e.id)).toEqual(["b"])
  })

  it("undo/redo walk the command history", () => {
    createMap(10, 10)
    addEntity(entity("a"))
    expect(canUndo()).toBe(true)
    undo()
    expect(useMapStore.getState().map?.entities).toEqual([])
    expect(canRedo()).toBe(true)
    redo()
    expect(useMapStore.getState().map?.entities.map((e) => e.id)).toEqual(["a"])
  })

  it("entity commands are no-ops with no open map", () => {
    addEntity(entity("a"))
    expect(useMapStore.getState().map).toBeNull()
  })
})
