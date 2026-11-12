import { beforeEach, describe, expect, it } from "vitest"
import { useMapStore } from "../../../stores/mapStore"
import {
  addEntities,
  addEntity,
  addInitialEntities,
  addLevel,
  beginGesture,
  cancelGesture,
  endGesture,
  moveEntities,
  moveLevel,
  removeLevel,
  setEnvironment,
  updateEntity,
  canRedo,
  canUndo,
  closeMap,
  createMap,
  redo,
  removeEntities,
  undo,
} from "./index"
import { type MapEntity } from "../model/types"
import { useEditorStore } from "../../../stores/editorStore"
import { useMapFileStore } from "../../../stores/mapFileStore"

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
    expect(useMapStore.getState().map).toMatchObject({ width: 11, height: 1, entities: [] })
    expect(canUndo()).toBe(false)
  })

  it("addInitialEntities makes them part of a new map's baseline", () => {
    createMap(10, 10)
    const doc = useMapStore.getState().map!
    addInitialEntities(doc, [entity("ground")])
    expect(useMapStore.getState().map?.entities.map((e) => e.id)).toEqual(["ground"])
    expect(canUndo()).toBe(false)
    expect(useMapFileStore.getState().dirty).toBe(false)
  })

  it("addInitialEntities is a normal edit once the map was changed", () => {
    createMap(10, 10)
    const doc = useMapStore.getState().map!
    addEntity(entity("a"))
    addInitialEntities(doc, [entity("ground")])
    expect(useMapStore.getState().map?.entities.map((e) => e.id)).toEqual(["ground", "a"])
    undo()
    expect(useMapStore.getState().map?.entities.map((e) => e.id)).toEqual(["a"])
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

  it("addEntities with `under` puts entities at the bottom of the draw order", () => {
    createMap(5, 5)
    addEntity(entity("a"))
    addEntities([entity("b")], true)
    expect(useMapStore.getState().map?.entities.map((e) => e.id)).toEqual(["b", "a"])
  })

  it("updateEntity/moveEntities edit in place and mark the file dirty", () => {
    createMap(5, 5)
    useMapFileStore.getState().markClean()
    addEntity({ ...entity("a"), points: [{ x: 0, y: 0 }] })
    updateEntity("a", { rotation: 90 })
    moveEntities(["a"], { x: 1, y: -1 })
    const a = useMapStore.getState().map?.entities[0]
    expect(a?.rotation).toBe(90)
    expect(a?.position).toEqual({ x: 2, y: 1 })
    expect(a?.points).toEqual([{ x: 1, y: -1 }])
    expect(useMapFileStore.getState().dirty).toBe(true)
  })

  it("a gesture records a single undo step", () => {
    createMap(5, 5)
    beginGesture()
    addEntity(entity("a"))
    moveEntities(["a"], { x: 1, y: 0 })
    moveEntities(["a"], { x: 1, y: 0 })
    endGesture()
    expect(useMapStore.temporal.getState().pastStates).toHaveLength(1)
    undo()
    expect(useMapStore.getState().map?.entities).toEqual([])
  })

  it("cancelGesture restores the document and records nothing", () => {
    createMap(5, 5)
    beginGesture()
    addEntity(entity("a"))
    cancelGesture()
    expect(useMapStore.getState().map?.entities).toEqual([])
    expect(canUndo()).toBe(false)
  })

  it("removing a level drops its entities and moves the active level", () => {
    createMap(5, 5)
    const first = useMapStore.getState().map?.levels[0].id ?? ""
    addLevel({ id: "l2", name: "Upstairs" })
    expect(useEditorStore.getState().activeLevel).toBe("l2")
    addEntity({ ...entity("up"), level: "l2" })
    addEntity({ ...entity("down"), level: first })
    moveLevel("l2", -1)
    expect(useMapStore.getState().map?.levels.map((l) => l.id)).toEqual(["l2", first])
    removeLevel("l2")
    expect(useMapStore.getState().map?.entities.map((e) => e.id)).toEqual(["down"])
    expect(useEditorStore.getState().activeLevel).toBe(first)
    // The last level can't be removed.
    removeLevel(first)
    expect(useMapStore.getState().map?.levels).toHaveLength(1)
  })

  it("undo drops selected ids that no longer exist", () => {
    createMap(5, 5)
    addEntity(entity("a"))
    useEditorStore.getState().select(["a"])
    undo()
    expect(useEditorStore.getState().selection).toEqual([])
  })

  it("setEnvironment changes the ambient light", () => {
    createMap(5, 5)
    setEnvironment({ ambientLight: "#202040" })
    expect(useMapStore.getState().map?.environment.ambientLight).toBe("#202040")
  })
})
