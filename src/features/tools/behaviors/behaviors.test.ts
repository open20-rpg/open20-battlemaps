import { beforeEach, describe, expect, it } from "vitest"
import { useEditorStore } from "../../../stores/editorStore"
import { useMapStore } from "../../../stores/mapStore"
import { useSettingsStore } from "../../../stores/settingsStore"
import { getToolParams, useToolsStore } from "../../../stores/toolsStore"
import { useViewStore } from "../../../stores/viewStore"
import { canUndo, closeMap, createMap, redo, undo } from "../../map/commands"
import { normalizeDocument, type MapEntity } from "../../map/model/types"
import { LIBRARY_PARAM } from "../params"
import { buildToolCtx } from "./context"
import { getToolBehavior, isToolActionDisabled, runToolAction } from "./index"
import { scatterAt, scatterSpacing } from "./objects"
import { terrainSlots } from "./paint"
import { decodeWeights, type TerrainData } from "../../map/model/terrain"
import { instantiatePrefab, prefabFrom } from "./settings"
import { nearestWall, screenAngle } from "./structures"
import { entitiesInRect } from "./select"
import { type PointerInfo } from "./types"
import { pressKey, releaseAll } from "../../shortcuts/held"
import { runShortcut } from "../../map/shortcuts"

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({
  x,
  y,
  button: 0,
  buttons: 1,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  ...extra,
})

/** Select a tool and run one of its handlers with a fresh context. */
function act(
  toolId: string,
  run: (
    b: NonNullable<ReturnType<typeof getToolBehavior>>,
    ctx: NonNullable<ReturnType<typeof buildToolCtx>>,
  ) => void,
) {
  const behavior = getToolBehavior(toolId)
  const ctx = buildToolCtx(toolId)
  if (!behavior || !ctx) throw new Error(`no behavior/ctx for ${toolId}`)
  run(behavior, ctx)
}
const down = (tool: string, x: number, y: number, extra?: Partial<PointerInfo>) =>
  act(tool, (b, c) => b.onPointerDown?.(c, at(x, y, extra)))
const move = (tool: string, x: number, y: number, extra?: Partial<PointerInfo>) =>
  act(tool, (b, c) => b.onPointerMove?.(c, at(x, y, extra)))
const up = (tool: string, x: number, y: number) => act(tool, (b, c) => b.onPointerUp?.(c, at(x, y)))
/** Press and release at the same point (tools that place on release). */
const tap = (tool: string, x: number, y: number, extra?: Partial<PointerInfo>) => {
  down(tool, x, y, extra)
  up(tool, x, y)
}
const wheel = (tool: string, dir: 1 | -1, extra?: Partial<PointerInfo>) =>
  act(tool, (b, c) => b.onWheel?.(c, { ...at(5, 5, extra), dir, horizontal: false }))
const dbl = (tool: string, x: number, y: number) =>
  act(tool, (b, c) => b.onDoubleClick?.(c, at(x, y)))

const entities = (): MapEntity[] => useMapStore.getState().map?.entities ?? []
const setParams = (tool: string, patch: Record<string, unknown>) => {
  useToolsStore.getState().selectToolById(tool)
  useToolsStore.getState().setToolParams(tool, patch)
}

beforeEach(() => {
  closeMap()
  createMap(20, 20)
  useViewStore.setState({ snap: true })
})

describe("wheel and right-click mouse shortcuts", () => {
  it("Object: wheel rotates 15°, Alt+wheel scales, right-click turns 90°", () => {
    setParams("object", { [LIBRARY_PARAM]: ["p|a"], rotation: 0, scale: 1 })
    wheel("object", 1)
    expect(getToolParams("object").rotation).toBe(15)
    wheel("object", -1, { altKey: true })
    expect(getToolParams("object").scale).toBeCloseTo(0.9)
    tap("object", 5, 5, { button: 2 })
    expect(getToolParams("object").rotation).toBe(90)
    tap("object", 5, 5, { button: 2, altKey: true })
    expect(getToolParams("object").rotation).toBe(0)
    expect(entities()).toEqual([])
  })

  it("Select: wheel turns the selection; Light: wheel changes its range", () => {
    setParams("object", { [LIBRARY_PARAM]: ["p|a"], rotation: 0 })
    tap("object", 5, 5)
    useToolsStore.getState().selectToolById("select")
    useEditorStore.getState().select([entities()[0].id])
    wheel("select", -1)
    expect(entities()[0].rotation).toBe(-15)
    setParams("light", { range: 5 })
    wheel("light", 1)
    expect(getToolParams("light").range).toBe(6)
    wheel("light", -1, { shiftKey: true })
    expect(getToolParams("light").range).toBeCloseTo(5.9)
  })
})

describe("object & scatter", () => {
  it("Object stamps the library asset at the snapped click, with its params", () => {
    setParams("object", {
      [LIBRARY_PARAM]: ["p|textures/objects/chair.png"],
      rotation: 45,
      scale: 2,
    })
    tap("object", 3.3, 4.6)
    const [e] = entities()
    expect(e).toMatchObject({
      toolId: "object",
      position: { x: 3.5, y: 4.5 },
      rotation: 45,
      scale: 2,
      layer: 100,
      params: { asset: "p|textures/objects/chair.png" },
    })
    expect(e.level).toBe(useMapStore.getState().map?.levels[0].id)
  })

  it("Object does nothing without a library pick", () => {
    useToolsStore.getState().selectToolById("object")
    tap("object", 1, 1)
    expect(entities()).toEqual([])
  })

  it("Scatter sprays objects spaced by Spread in one undo step", () => {
    setParams("scatter", { [LIBRARY_PARAM]: ["p|a", "p|b"], spread: 0 })
    down("scatter", 0, 0)
    for (let x = 0.25; x <= 5; x += 0.25) move("scatter", x, 0)
    up("scatter", 5, 0)
    expect(entities().length).toBeGreaterThanOrEqual(5)
    expect(entities().every((e) => ["p|a", "p|b"].includes(e.params.asset as string))).toBe(true)
    undo()
    expect(entities()).toEqual([])
  })

  it("Scatter: Ctrl+click places nothing; Shift+wheel re-rolls the next asset", () => {
    setParams("scatter", { [LIBRARY_PARAM]: ["p|a", "p|b"], spread: 0 })
    down("scatter", 1, 1, { ctrlKey: true })
    up("scatter", 1, 1)
    expect(entities()).toEqual([])
    const placeAt = (x: number) => {
      down("scatter", x, 1)
      up("scatter", x, 1)
      return entities().at(-1)?.params.asset
    }
    // With two assets each re-roll switches to the other one.
    const first = placeAt(0)
    expect(placeAt(2)).not.toBe(first)
    wheel("scatter", 1, { shiftKey: true })
    expect(placeAt(4)).not.toBe(first)
  })

  it("Edit points: Delete removes the clicked vertex, keeping a usable shape", () => {
    useToolsStore.getState().selectToolById("wall")
    down("wall", 0, 0)
    down("wall", 4, 0)
    down("wall", 4, 4)
    dbl("wall", 4, 4)
    setParams("wall", { editPoints: true })
    const del = () => act("wall", (b, c) => b.onKeyDown?.(c, { key: "Delete" } as KeyboardEvent))
    down("wall", 4, 0)
    up("wall", 4, 0)
    del()
    expect(entities()[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 4 },
    ])
    down("wall", 0, 0)
    up("wall", 0, 0)
    del()
    expect(entities()[0].points).toHaveLength(2)
  })

  it("scatter randomizes within the param ranges", () => {
    setParams("scatter", { [LIBRARY_PARAM]: ["p|a"], rotation: [10, 20], scale: [2, 2] })
    const ctx = buildToolCtx("scatter")
    const e = ctx && scatterAt(ctx, { x: 0, y: 0 }, () => 0.5)
    expect(e?.rotation).toBe(15)
    expect(e?.scale).toBe(2)
    expect(scatterSpacing(-1)).toBe(0.25)
  })
})

describe("map settings", () => {
  it("Building Wear mirrors the document's (undoable)", () => {
    const wear = () => useMapStore.getState().map?.buildingWear
    expect(wear()).toBe("grime")
    useToolsStore.getState().selectToolById("mapSettings")
    act("mapSettings", (b, c) => b.onActivate?.(c))
    act("mapSettings", (b, c) => b.onParamsChange?.(c, { buildingWear: "scratched" }))
    expect(wear()).toBe("scratched")
    undo()
    expect(wear()).toBe("grime")
    closeMap()
    createMap(5, 5, "none")
    expect(wear()).toBe("none")
    act("mapSettings", (b, c) => b.onActivate?.(c))
    expect(getToolParams("mapSettings").buildingWear).toBe("none")
    expect(normalizeDocument({ width: 2, height: 2 }).buildingWear).toBe("grime")
  })

  it("Post-processing is the map's: undoable, saved with it, new maps start neutral", () => {
    const pp = () => useMapStore.getState().map?.postProcess
    useToolsStore.getState().selectToolById("postProcessing")
    act("postProcessing", (b, c) => b.onActivate?.(c))
    act("postProcessing", (b, c) => b.onParamsChange?.(c, { brightness: 0.3, filter: "sepia" }))
    expect(pp()).toMatchObject({ brightness: 0.3, filter: "sepia" })
    undo()
    expect(pp()).toMatchObject({ brightness: 0, filter: "none" })
    redo()
    closeMap()
    createMap(5, 5)
    expect(pp()).toMatchObject({ brightness: 0, filter: "none" })
    // Saved maps carry it; older ones (and bad values) get the defaults.
    const loaded = normalizeDocument({
      width: 2,
      height: 2,
      postProcess: { brightness: 0.5, contrast: 0, saturation: 0, threshold: 0.5, filter: "bogus" },
    } as never)
    expect(loaded.postProcess).toMatchObject({ brightness: 0.5, filter: "none" })
    expect(normalizeDocument({ width: 2, height: 2 }).postProcess.brightness).toBe(0)
  })
})

describe("walls, build, portals", () => {
  it("Wall clicks out a polyline finished by double-click", () => {
    useToolsStore.getState().selectToolById("wall")
    down("wall", 0, 0)
    down("wall", 4.2, 0)
    down("wall", 4, 3)
    dbl("wall", 4, 3)
    const [wall] = entities()
    expect(wall.toolId).toBe("wall")
    expect(wall.points).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ])
    expect(useEditorStore.getState().draft).toEqual([])
  })

  it("Shift+click adds an arc tangent to the last segment; the wheel sets its pieces", () => {
    useToolsStore.getState().selectToolById("wall")
    down("wall", 0, 0)
    down("wall", 2, 0)
    move("wall", 4, 2, { buttons: 0, shiftKey: true })
    wheel("wall", -1, { shiftKey: true })
    wheel("wall", -1, { shiftKey: true })
    down("wall", 4, 2, { shiftKey: true })
    // Default 8 pieces, minus two notches: the arc adds 6 points.
    const key = (k: string) =>
      act("wall", (b, c) => b.onKeyDown?.(c, { key: k, ctrlKey: false } as KeyboardEvent))
    key("Backspace")
    down("wall", 4, 2, { shiftKey: true })
    key("Enter")
    const [wall] = entities()
    expect(wall.points).toHaveLength(2 + 6)
    expect(wall.points?.at(-1)).toEqual({ x: 4, y: 2 })
    // Every arc point is 2 tiles from the arc's center (2, 2).
    for (const p of wall.points?.slice(2) ?? []) expect(Math.hypot(p.x - 2, p.y - 2)).toBeCloseTo(2)
  })

  it("Ctrl when finishing joins the wall to the walls it meets", () => {
    useToolsStore.getState().selectToolById("wall")
    const draw = (pts: [number, number][], ctrlKey = false) => {
      for (const [x, y] of pts) down("wall", x, y)
      const [x, y] = pts[pts.length - 1]
      act("wall", (b, c) => b.onDoubleClick?.(c, at(x, y, { ctrlKey })))
    }
    draw([
      [0, 0],
      [4, 0],
    ])
    draw([
      [8, 0],
      [8, 4],
    ])
    // Bridges both: one wall from (0,0) through (8,4).
    draw(
      [
        [4, 0],
        [8, 0],
      ],
      true,
    )
    expect(entities()).toHaveLength(1)
    expect(entities()[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 4 },
    ])
    undo()
    expect(entities()).toHaveLength(2)
  })

  it("a room's floor and wall move and reshape together, but delete apart", () => {
    useToolsStore.getState().selectToolById("build")
    down("build", 0, 0)
    move("build", 4, 4)
    up("build", 4, 4)
    const [floor, wall] = entities()
    expect(floor.link).toBeDefined()
    expect(wall.link).toBe(floor.link)
    useToolsStore.getState().selectToolById("select")
    setParams("select", { filter: ["floors"] })
    // Drag the floor by its middle: the wall comes along.
    down("select", 2, 2)
    move("select", 3, 2)
    up("select", 3, 2)
    expect(useEditorStore.getState().selection).toEqual([floor.id])
    const byId = (id: string) => entities().find((x) => x.id === id)
    expect(byId(wall.id)?.points?.[0]).toEqual({ x: 1, y: 0 })
    // Drag a floor vertex (the selection's points): the wall's moves too.
    down("select", 5, 4)
    move("select", 6, 5)
    up("select", 6, 5)
    expect(byId(wall.id)?.points).toContainEqual({ x: 6, y: 5 })
    // Flip: both mirror.
    runToolAction("select", "flipH")
    expect(byId(wall.id)?.points).toEqual(byId(floor.id)?.points)
    // Deleting the floor keeps the wall.
    useEditorStore.getState().select([floor.id])
    runShortcut({
      key: "Delete",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    } as KeyboardEvent)
    expect(byId(floor.id)).toBeUndefined()
    expect(byId(wall.id)).toBeDefined()
  })

  it("Alt cuts the shape out of rooms (walls rebuilt) and patterns; Water gets an eraser", () => {
    const drag = (tool: string, a: [number, number], b: [number, number]) => {
      down(tool, ...a)
      move(tool, ...b)
      up(tool, ...b)
    }
    useToolsStore.getState().selectToolById("build")
    drag("build", [0, 0], [6, 6])
    pressKey("Alt")
    // A hole in the middle: one floor (bridged ring) and two closed walls.
    drag("build", [2, 2], [4, 4])
    releaseAll()
    const floors = entities().filter((e) => e.toolId === "build")
    const walls = entities().filter((e) => e.toolId === "wall")
    expect(floors).toHaveLength(1)
    expect(floors[0].points).toHaveLength(10)
    expect(walls.map((w) => w.points?.length)).toEqual([4, 4])
    undo()
    expect(entities().filter((e) => e.toolId === "wall")[0].points).toHaveLength(4)
    expect(entities()).toHaveLength(2)

    setParams("pattern", { shape: "rectangle" })
    drag("pattern", [10, 0], [14, 4])
    pressKey("Alt")
    drag("pattern", [12, -1], [15, 5])
    releaseAll()
    const [pattern] = entities().filter((e) => e.toolId === "pattern")
    expect(pattern.points).toHaveLength(4)
    expect(Math.max(...(pattern.points ?? []).map((p) => p.x))).toBe(12)

    setParams("water", { shape: "rectangle" })
    pressKey("Alt")
    drag("water", [0, 10], [2, 12])
    releaseAll()
    expect(entities().find((e) => e.toolId === "water")?.params.erase).toBe(true)
  })

  it("the Paint/Erase control does what Alt does (touch has no Alt)", () => {
    const drag = (tool: string, a: [number, number], b: [number, number]) => {
      down(tool, ...a)
      move(tool, ...b)
      up(tool, ...b)
    }
    setParams("pattern", { shape: "rectangle", paintMode: "paint" })
    drag("pattern", [10, 0], [14, 4])
    setParams("pattern", { paintMode: "erase" })
    drag("pattern", [12, -1], [15, 5])
    const [pattern] = entities().filter((e) => e.toolId === "pattern")
    expect(Math.max(...(pattern.points ?? []).map((p) => p.x))).toBe(12)

    setParams("water", { shape: "rectangle", paintMode: "erase" })
    drag("water", [0, 10], [2, 12])
    expect(entities().find((e) => e.toolId === "water")?.params.erase).toBe(true)
    setParams("water", { paintMode: "paint" })
    drag("water", [4, 10], [6, 12])
    expect(
      entities()
        .filter((e) => e.toolId === "water")
        .at(-1)?.params.erase,
    ).toBeUndefined()
  })

  it("previews the real wall and room while they're being drawn", () => {
    useToolsStore.getState().selectToolById("wall")
    down("wall", 0, 0)
    move("wall", 3, 0, { buttons: 0 })
    const ghosts = () =>
      useEditorStore.getState().draft.flatMap((d) => (d.kind === "ghost" ? [d.entity] : []))
    expect(ghosts().map((e) => e.toolId)).toEqual(["wall"])
    expect(ghosts()[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ])
    act("wall", (b, c) => b.onKeyDown?.(c, { key: "Escape" } as KeyboardEvent))
    useToolsStore.getState().selectToolById("build")
    down("build", 1, 1)
    move("build", 4, 3)
    expect(ghosts().map((e) => e.toolId)).toEqual(["build", "wall"])
    up("build", 4, 3)
    expect(ghosts()).toEqual([])
    // The preview never touched the document: only the committed room exists.
    expect(entities().map((e) => e.toolId)).toEqual(["build", "wall"])
  })

  it("Escape cancels an unfinished wall", () => {
    useToolsStore.getState().selectToolById("wall")
    down("wall", 0, 0)
    act("wall", (b, c) => b.onKeyDown?.(c, { key: "Escape" } as KeyboardEvent))
    dbl("wall", 1, 0)
    expect(entities()).toEqual([])
  })

  it("Build drags a room: floor + closed wall, one undo step", () => {
    useToolsStore.getState().selectToolById("build")
    down("build", 1, 1)
    move("build", 5, 4)
    up("build", 5, 4)
    const [floor, wall] = entities()
    expect(floor).toMatchObject({ toolId: "build", closed: true, layer: -200 })
    expect(wall).toMatchObject({ toolId: "wall", closed: true, layer: 600 })
    expect(floor.points).toHaveLength(4)
    undo()
    expect(entities()).toEqual([])
    expect(canUndo()).toBe(false)
  })

  it("edit-points mode drags a wall vertex", () => {
    useToolsStore.getState().selectToolById("wall")
    down("wall", 0, 0)
    down("wall", 4, 0)
    dbl("wall", 4, 0)
    setParams("wall", { editPoints: true })
    act("wall", (b, c) => b.onActivate?.(c))
    // Edit mode shows the line joining the points under the handles.
    expect(useEditorStore.getState().draft.map((d) => d.kind)).toEqual(["polyline", "handles"])
    down("wall", 4, 0)
    move("wall", 6, 2)
    up("wall", 6, 2)
    expect(entities()[0].points?.[1]).toEqual({ x: 6, y: 2 })
  })

  it("anchored portals snap onto the nearest wall and align with it", () => {
    useToolsStore.getState().selectToolById("wall")
    down("wall", 0, 0)
    down("wall", 0, 6)
    dbl("wall", 0, 6)
    setParams("portal", { style: { assets: ["p|textures/portals/door.png"], color: "#fff" } })
    tap("portal", 0.4, 3.1)
    const portal = entities().find((e) => e.toolId === "portal")
    expect(portal?.position).toEqual({ x: 0, y: 3 })
    expect(portal?.rotation).toBe(90)
    // Far from any wall: nothing placed.
    tap("portal", 10, 10)
    expect(entities().filter((e) => e.toolId === "portal")).toHaveLength(1)
  })

  it("screen angles account for the mirrored x axis", () => {
    expect(screenAngle({ x: -1, y: 0 })).toBe(0)
    expect(screenAngle({ x: 1, y: 0 })).toBe(180)
    const wall: MapEntity = {
      id: "w",
      toolId: "wall",
      layer: 600,
      position: { x: 0, y: 0 },
      rotation: 0,
      points: [
        { x: 0, y: 0 },
        { x: -4, y: 0 },
      ],
      params: {},
    }
    expect(nearestWall([wall], { x: -2, y: 0.5 }, 1)).toEqual({ point: { x: -2, y: 0 }, angle: 0 })
  })
})

describe("painting", () => {
  it("Cave strokes are one entity per drag; Blast Open paints the blasted area", () => {
    useToolsStore.getState().selectToolById("cave")
    down("cave", 2, 2)
    move("cave", 4, 2)
    up("cave", 4, 2)
    setParams("cave", { brushMode: "blast" })
    down("cave", 3, 2)
    up("cave", 3, 2)
    const [dig, blast] = entities()
    expect(dig.strokes?.[0].points.length).toBeGreaterThan(1)
    expect(dig.strokes?.[0].erase).toBeUndefined()
    // Blasting doesn't un-dig (that's Alt): it paints its own area.
    expect(blast.strokes?.[0]).toMatchObject({ blast: true })
    expect(blast.strokes?.[0].erase).toBeUndefined()
    // The default brush: a 4-cell stamp, a tile across.
    expect(dig.strokes?.[0].radius).toBe(0.5)
  })

  it("Water rectangles become closed polygon bodies", () => {
    setParams("water", { shape: "rectangle" })
    down("water", 1, 1)
    move("water", 3, 3)
    up("water", 3, 3)
    expect(entities()[0]).toMatchObject({ toolId: "water", closed: true })
  })

  it("Giving slot 1 its texture fills the level's ground with it right away", () => {
    useToolsStore.getState().selectToolById("terrainBrush")
    const biome = {
      biome: "settlement",
      slotsByBiome: { settlement: [{ id: "p|t0", name: "a", thumb: "" }] },
      unlocked: false,
      selectedSlot: 0,
    }
    setParams("terrainBrush", { biome })
    act("terrainBrush", (b, c) => b.onParamsChange?.(c, { biome }))
    const [terrain] = entities()
    expect(terrain.toolId).toBe("terrainBrush")
    const data = terrain.params.terrain as TerrainData
    expect(data.slots[0]).toBe("p|t0")
    expect(decodeWeights(data.weights)[0]).toBe(255)
  })

  it("Terrain needs a texture in the selected slot; Fill covers the map", () => {
    useToolsStore.getState().selectToolById("terrainBrush")
    down("terrainBrush", 1, 1)
    expect(entities()).toEqual([])
    expect(isToolActionDisabled("terrainBrush", "fill")).toBe(true)
    const biome = {
      biome: "settlement",
      slotsByBiome: {
        settlement: [
          { id: "p|t0", name: "a", thumb: "" },
          { id: "p|t1", name: "b", thumb: "" },
        ],
      },
      unlocked: false,
      selectedSlot: 1,
    }
    setParams("terrainBrush", { biome })
    expect(terrainSlots(biome)).toEqual({ selected: "p|t1", base: "p|t0" })
    // A press paints slot 1 under the brush into a new terrain (all slot 0)…
    setParams("terrainBrush", { biome, brushSize: 2, intensity: 8 })
    down("terrainBrush", 10, 10)
    up("terrainBrush", 10, 10)
    expect(entities()).toHaveLength(1)
    const data = entities()[0].params.terrain as TerrainData
    expect(data.slots.slice(0, 3)).toEqual(["p|t0", "p|t1", null])
    // Map 20×20 tiles: map x 10 → texel 40; the brush center there.
    const at = (tx: number, ty: number) => decodeWeights(data.weights)[(ty * 80 + tx) * 8 + 1]
    expect(at(40, 40)).toBeGreaterThan(0)
    expect(at(10, 10)).toBe(0)
    // …in one undo step; Fill puts the whole level in the slot.
    undo()
    expect(entities()).toEqual([])
    runToolAction("terrainBrush", "fill")
    const filled = decodeWeights((entities()[0].params.terrain as TerrainData).weights)
    expect(filled[1]).toBe(255)
    expect(filled[0]).toBe(0)
  })
})

describe("effects, text, select, prefabs", () => {
  it("Environment writes the ambient light to the document", () => {
    useToolsStore.getState().selectToolById("environment")
    useToolsStore.getState().setToolParams("environment", { ambientLight: "#101020" })
    act("environment", (b, c) => b.onParamsChange?.(c, { ambientLight: "#101020" }))
    expect(useMapStore.getState().map?.environment.ambientLight).toBe("#101020")
  })

  it("places objects and lights where released, previewing them while pressed", () => {
    setParams("object", { [LIBRARY_PARAM]: ["p|a"] })
    down("object", 2, 2)
    // Pressed: shown, not placed yet; dragging moves it.
    expect(entities()).toHaveLength(0)
    expect(useEditorStore.getState().draft[0]?.kind).toBe("ghost")
    move("object", 6, 4)
    up("object", 6, 4)
    expect(entities().map((e) => e.position)).toEqual([{ x: 6, y: 4 }])

    useToolsStore.getState().selectToolById("light")
    down("light", 10, 10)
    expect(entities()).toHaveLength(1)
    move("light", 12, 11)
    up("light", 12, 11)
    expect(entities()[1]).toMatchObject({ toolId: "light", position: { x: 12, y: 11 } })
  })

  it("Light places lights and drags them by their center", () => {
    useToolsStore.getState().selectToolById("light")
    down("light", 5, 5)
    up("light", 5, 5)
    expect(entities()[0]).toMatchObject({ toolId: "light", position: { x: 5, y: 5 } })
    down("light", 5, 5)
    move("light", 8, 6)
    up("light", 8, 6)
    expect(entities()).toHaveLength(1)
    expect(entities()[0].position).toEqual({ x: 8, y: 6 })
  })

  it("Text opens an editor; committing creates the label", async () => {
    const { commitTextEdit } = await import("./text")
    useToolsStore.getState().selectToolById("text")
    down("text", 4, 4)
    up("text", 4, 4)
    const edit = useEditorStore.getState().textEdit
    expect(edit).toMatchObject({ entityId: null, position: { x: 4, y: 4 } })
    useEditorStore.getState().setTextEdit({ ...edit!, value: "Tavern" })
    commitTextEdit()
    expect(entities()[0]).toMatchObject({ toolId: "text", text: "Tavern" })
  })

  it("Text shows a label's own look when it's picked; a change edits just that", async () => {
    const { commitTextEdit } = await import("./text")
    // A label with a look of its own…
    setParams("text", { fontSize: 40, fontColor: "#ff0000" })
    down("text", 4, 4)
    up("text", 4, 4)
    useEditorStore.getState().setTextEdit({ ...useEditorStore.getState().textEdit!, value: "Inn" })
    commitTextEdit()
    // …while the tool moved on to another one.
    setParams("text", { fontSize: 96, fontColor: "#00ff00" })
    // (Its position is the box's top-left corner: map x grows leftward.)
    down("text", 3.8, 4.2)
    up("text", 3.8, 4.2)
    expect(getToolParams("text")).toMatchObject({ fontSize: 40, fontColor: "#ff0000" })
    commitTextEdit()
    // Changing the color keeps its size.
    useToolsStore.getState().setToolParams("text", { fontColor: "#0000ff" })
    act("text", (b, c) => b.onParamsChange?.(c, { fontColor: "#0000ff" }))
    expect(entities()[0].params).toMatchObject({ fontSize: 40, fontColor: "#0000ff" })
  })

  it("double tap on a line adds a point that drags at once; right-click removes one", () => {
    useToolsStore.getState().selectToolById("wall")
    down("wall", 0, 0)
    down("wall", 6, 0)
    dbl("wall", 6, 0)
    const wall = () => entities()[0]
    useToolsStore.getState().selectToolById("select")
    down("select", 3, 0)
    up("select", 3, 0)
    expect(useEditorStore.getState().selection).toEqual([wall().id])
    // Second tap: inserts at (3, 0) and keeps dragging it, one undo step.
    down("select", 3, 0)
    move("select", 3, 2)
    up("select", 3, 2)
    expect(wall().points).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 2 },
      { x: 6, y: 0 },
    ])
    undo()
    expect(wall().points).toHaveLength(2)
    redo()
    // Right-click on the new point removes it; a line keeps its 2 points.
    down("select", 3, 2, { button: 2, buttons: 2 })
    expect(wall().points).toHaveLength(2)
    down("select", 0, 0, { button: 2, buttons: 2 })
    expect(wall().points).toHaveLength(2)
  })

  it("Edit Points: double tap adds a point, right-click removes it", () => {
    useToolsStore.getState().selectToolById("wall")
    down("wall", 0, 0)
    down("wall", 6, 0)
    dbl("wall", 6, 0)
    setParams("wall", { editPoints: true })
    down("wall", 2, 0)
    up("wall", 2, 0)
    down("wall", 2, 0)
    up("wall", 2, 0)
    expect(entities()[0].points).toHaveLength(3)
    down("wall", 2, 0, { button: 2, buttons: 2 })
    expect(entities()[0].points).toHaveLength(2)
  })

  it("Select picks a wall a few screen px off its line", () => {
    useToolsStore.getState().selectToolById("wall")
    down("wall", 0, 0)
    down("wall", 6, 0)
    dbl("wall", 6, 0)
    useToolsStore.getState().selectToolById("select")
    // Off the line by more than the old fixed reach (0.35 tiles).
    useViewStore.setState({ zoom: 25 })
    down("select", 3, 0.5)
    up("select", 3, 0.5)
    expect(useEditorStore.getState().selection).toEqual([entities()[0].id])
    useViewStore.setState({ zoom: 100 })
  })

  it("Select picks, rubber-bands and drag-moves (one undo step)", () => {
    setParams("object", { [LIBRARY_PARAM]: ["p|a"] })
    tap("object", 2, 2)
    tap("object", 6, 6)
    useToolsStore.getState().selectToolById("select")
    down("select", 2, 2)
    up("select", 2, 2)
    expect(useEditorStore.getState().selection).toHaveLength(1)
    down("select", 10, 10)
    move("select", 0, 0)
    up("select", 0, 0)
    expect(useEditorStore.getState().selection).toHaveLength(2)
    down("select", 2, 2)
    move("select", 3, 2)
    up("select", 3, 2)
    expect(entities().map((e) => e.position.x)).toEqual([3, 7])
    undo()
    expect(entities().map((e) => e.position.x)).toEqual([2, 6])
  })

  it("prefabs store entities around their center and stamp fresh copies", () => {
    const a: MapEntity = {
      id: "a",
      toolId: "object",
      layer: 100,
      position: { x: 2, y: 2 },
      rotation: 0,
      params: {},
    }
    const prefab = prefabFrom([a, { ...a, id: "b", position: { x: 4, y: 2 } }], () => undefined)
    expect(prefab?.entities.map((e) => e.position)).toEqual([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ])
    const copies = prefab ? instantiatePrefab(prefab, { x: 10, y: 10 }, "L") : []
    expect(copies.map((c) => c.position)).toEqual([
      { x: 9, y: 10 },
      { x: 11, y: 10 },
    ])
    expect(copies.every((c) => c.level === "L" && c.id !== "a" && c.id !== "b")).toBe(true)
  })

  it("Prefabs saves the selection and stamps it where clicked", () => {
    useSettingsStore.setState({ prefabs: [] })
    setParams("object", { [LIBRARY_PARAM]: ["p|a"] })
    tap("object", 2, 2)
    useEditorStore.getState().select([entities()[0].id])
    useToolsStore.getState().selectToolById("prefabs")
    runToolAction("prefabs", "save")
    expect(useSettingsStore.getState().prefabs).toHaveLength(1)
    tap("prefabs", 8, 8)
    expect(entities()).toHaveLength(2)
    expect(entities()[1].position).toEqual({ x: 8, y: 8 })
  })

  it("Select's corner handle scales from the opposite corner; the top handle rotates", () => {
    useViewStore.setState({ zoom: 100 })
    setParams("object", { [LIBRARY_PARAM]: ["p|a"] })
    tap("object", 5, 5)
    useToolsStore.getState().selectToolById("select")
    useEditorStore.getState().select([entities()[0].id])
    // Box 4.5..5.5: drag the (5.5, 5.5) corner to (6.5, 6.5) → ×2, (4.5, 4.5) fixed.
    down("select", 5.5, 5.5)
    move("select", 6.5, 6.5)
    up("select", 6.5, 6.5)
    expect(entities()[0].scale).toBeCloseTo(2)
    expect(entities()[0].position.x).toBeCloseTo(5.5)
    expect(entities()[0].position.y).toBeCloseTo(5.5)
    // Box is now 4.5..6.5; the rotate handle is 24 px (24/64 tiles) above its top.
    down("select", 5.5, 4.5 - 24 / 64)
    // Pointer to screen-right of the center (map x decreases): +90° clockwise.
    move("select", 3, 5.5)
    up("select", 3, 5.5)
    expect(entities()[0].rotation).toBeCloseTo(90)
    undo()
    expect(entities()[0].rotation).toBe(0)
    undo()
    expect(entities()[0].scale ?? 1).toBe(1)
    expect(entities()[0].position).toEqual({ x: 5, y: 5 })
  })

  it("an edge handle stretches a wall on one axis, keeping the opposite edge", () => {
    useViewStore.setState({ zoom: 100 })
    useToolsStore.getState().selectToolById("wall")
    down("wall", 2, 2)
    down("wall", 6, 2)
    dbl("wall", 6, 2)
    useToolsStore.getState().selectToolById("select")
    useEditorStore.getState().select([entities()[0].id])
    // The box includes the wall's thickness (0.15 each side): x 1.85..6.15,
    // so the x-edge handle is at (6.15, 2) and the anchor at x = 1.85.
    down("select", 6.15, 2)
    move("select", 8.15, 2)
    up("select", 8.15, 2)
    const [a, b] = entities()[0].points ?? []
    // The far end follows the pointer onto the grid (the points, not the
    // thickness-padded box, are what snaps); the near end stays; y untouched.
    expect(b.x).toBeCloseTo(8)
    expect(a.x).toBeCloseTo(2)
    expect(a.y).toBe(2)
    expect(b.y).toBe(2)
    // Without Snap to Grid it follows the pointer exactly.
    useViewStore.setState({ snap: false })
    down("select", 8.15, 2)
    move("select", 8.4, 2)
    up("select", 8.4, 2)
    expect(entities()[0].points?.[1].x).toBeCloseTo(8.25)
    expect(entities()[0].points?.[0].x).toBeCloseTo(2)
  })

  it("Select drags a lone wall's points (one undo step)", () => {
    useViewStore.setState({ zoom: 100 })
    useToolsStore.getState().selectToolById("wall")
    down("wall", 2, 2)
    down("wall", 6, 2)
    dbl("wall", 6, 2)
    useToolsStore.getState().selectToolById("select")
    useEditorStore.getState().select([entities()[0].id])
    down("select", 6, 2)
    move("select", 6.9, 4.1)
    up("select", 6.9, 4.1)
    expect(entities()[0].points).toEqual([
      { x: 2, y: 2 },
      { x: 7, y: 4 },
    ])
    undo()
    expect(entities()[0].points?.[1]).toEqual({ x: 6, y: 2 })
  })

  it("Shift snaps handle rotation to 15° steps", () => {
    useViewStore.setState({ zoom: 100 })
    setParams("object", { [LIBRARY_PARAM]: ["p|a"] })
    tap("object", 5, 5)
    useToolsStore.getState().selectToolById("select")
    useEditorStore.getState().select([entities()[0].id])
    down("select", 5, 4.5 - 24 / 64)
    move("select", 4.2, 4.5, { shiftKey: true })
    up("select", 4.2, 4.5)
    expect(entities()[0].rotation % 15).toBeCloseTo(0)
  })

  it("Select picks whole groups; Group / Ungroup (one undo step each)", () => {
    setParams("object", { [LIBRARY_PARAM]: ["p|a"] })
    tap("object", 2, 2)
    tap("object", 6, 6)
    tap("object", 10, 10)
    useToolsStore.getState().selectToolById("select")
    const [a, b, c] = entities().map((e) => e.id)
    useEditorStore.getState().select([a, b])
    expect(isToolActionDisabled("select", "ungroup")).toBe(true)
    runToolAction("select", "group")
    expect(entities()[0].group).toBeDefined()
    expect(entities()[1].group).toBe(entities()[0].group)
    // Clicking one member selects the group; the loose one stays alone.
    useEditorStore.getState().select([])
    down("select", 6, 6)
    up("select", 6, 6)
    expect([...useEditorStore.getState().selection].sort()).toEqual([a, b].sort())
    useEditorStore.getState().select([c])
    expect(isToolActionDisabled("select", "group")).toBe(true)
    useEditorStore.getState().select([a, b])
    runToolAction("select", "ungroup")
    expect(entities().every((e) => !e.group)).toBe(true)
    undo()
    expect(entities()[0].group).toBeDefined()
  })

  it("Click through transparency: bands (and clicks) skip a sprite's transparent part", () => {
    setParams("object", { [LIBRARY_PARAM]: ["p|a"] })
    tap("object", 4, 4)
    setParams("select", { alphaPick: true })
    const base = buildToolCtx("select")
    if (!base) throw new Error("no ctx")
    // A 2×2-tile sprite whose texture is opaque only in its left half
    // (texture u < 0.5; map x is mirrored, so that's the larger map x).
    const ctx = {
      ...base,
      sizeOf: () => ({ w: 2, h: 2 }),
      alphaAt: (_id: string, u: number, v: number) =>
        u >= 0 && u < 0.5 && v >= 0 && v <= 1 ? 255 : 0,
    }
    const picked = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      entitiesInRect(ctx, a, b).map((e) => e.toolId)
    // Over the transparent half only: nothing; a click there: nothing.
    expect(picked({ x: 3.1, y: 3.5 }, { x: 3.6, y: 4.5 })).toEqual([])
    expect(picked({ x: 3.5, y: 4 }, { x: 3.5, y: 4 })).toEqual([])
    // Reaching the opaque half picks it.
    expect(picked({ x: 3.1, y: 3.5 }, { x: 4.5, y: 4.5 })).toEqual(["object"])
    // Off, the band goes by the sprite's box as before.
    setParams("select", { alphaPick: false })
    const off = { ...ctx, params: { ...ctx.params, alphaPick: false } }
    expect(entitiesInRect(off, { x: 3.1, y: 3.5 }, { x: 3.6, y: 4.5 })).toHaveLength(1)
  })

  it("Locked entities skip clicks and bands; an Alt band picks only them", () => {
    setParams("object", { [LIBRARY_PARAM]: ["p|a"] })
    tap("object", 2, 2)
    tap("object", 6, 6)
    useToolsStore.getState().selectToolById("select")
    const [a, b] = entities().map((e) => e.id)
    useEditorStore.getState().select([a])
    expect(isToolActionDisabled("select", "unlock")).toBe(true)
    runToolAction("select", "lock")
    expect(entities()[0].locked).toBe(true)
    useEditorStore.getState().select([])
    down("select", 2, 2)
    up("select", 2, 2)
    expect(useEditorStore.getState().selection).toEqual([])
    const band = (altKey: boolean) => {
      down("select", 10, 10, { altKey })
      move("select", 0, 0, { altKey })
      up("select", 0, 0)
      return useEditorStore.getState().selection
    }
    expect(band(false)).toEqual([b])
    expect(band(true)).toEqual([a])
    runToolAction("select", "unlock")
    expect(entities()[0].locked).toBeUndefined()
    undo()
    expect(entities()[0].locked).toBe(true)
  })

  it("Select mirrors the selection (panel buttons / flip shortcuts)", () => {
    setParams("object", { [LIBRARY_PARAM]: ["p|a"], mirror: true })
    tap("object", 2, 2)
    expect(entities()[0].flipX).toBe(true)
    tap("object", 4, 2)
    useToolsStore.getState().selectToolById("select")
    expect(isToolActionDisabled("select", "flipH")).toBe(true)
    useEditorStore.getState().select(entities().map((e) => e.id))
    runToolAction("select", "flipH")
    // Positions swap across the group's center; flips toggle.
    expect(entities().map((e) => e.position.x)).toEqual([4, 2])
    // Both were placed mirrored (the param stays on); flipping un-mirrors them.
    expect(entities().map((e) => !!e.flipX)).toEqual([false, false])
    runToolAction("select", "flipV")
    expect(entities().every((e) => e.flipY)).toBe(true)
    undo()
    expect(entities().every((e) => !e.flipY)).toBe(true)
  })
})
