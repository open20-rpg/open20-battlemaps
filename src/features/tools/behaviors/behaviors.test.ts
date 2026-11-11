import { beforeEach, describe, expect, it } from "vitest"
import { useEditorStore } from "../../../stores/editorStore"
import { useMapStore } from "../../../stores/mapStore"
import { useSettingsStore } from "../../../stores/settingsStore"
import { useToolsStore } from "../../../stores/toolsStore"
import { useViewStore } from "../../../stores/viewStore"
import { canUndo, closeMap, createMap, undo } from "../../map/commands"
import { type MapEntity } from "../../map/model/types"
import { LIBRARY_PARAM } from "../params"
import { buildToolCtx } from "./context"
import { getToolBehavior, isToolActionDisabled, runToolAction } from "./index"
import { scatterAt, scatterSpacing } from "./objects"
import { terrainSlots } from "./paint"
import { instantiatePrefab, prefabFrom } from "./settings"
import { nearestWall, screenAngle } from "./structures"
import { type PointerInfo } from "./types"

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

describe("object & scatter", () => {
  it("Object stamps the library asset at the snapped click, with its params", () => {
    setParams("object", {
      [LIBRARY_PARAM]: ["p|textures/objects/chair.png"],
      rotation: 45,
      scale: 2,
    })
    down("object", 3.3, 4.6)
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
    down("object", 1, 1)
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

  it("scatter randomizes within the param ranges", () => {
    setParams("scatter", { [LIBRARY_PARAM]: ["p|a"], rotation: [10, 20], scale: [2, 2] })
    const ctx = buildToolCtx("scatter")
    const e = ctx && scatterAt(ctx, { x: 0, y: 0 }, () => 0.5)
    expect(e?.rotation).toBe(15)
    expect(e?.scale).toBe(2)
    expect(scatterSpacing(-1)).toBe(0.25)
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
    down("portal", 0.4, 3.1)
    const portal = entities().find((e) => e.toolId === "portal")
    expect(portal?.position).toEqual({ x: 0, y: 3 })
    expect(portal?.rotation).toBe(90)
    // Far from any wall: nothing placed.
    down("portal", 10, 10)
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
  it("Cave strokes are one entity per drag; Blast Open erases", () => {
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
    expect(blast.strokes?.[0].erase).toBe(true)
  })

  it("Water rectangles become closed polygon bodies", () => {
    setParams("water", { shape: "rectangle" })
    down("water", 1, 1)
    move("water", 3, 3)
    up("water", 3, 3)
    expect(entities()[0]).toMatchObject({ toolId: "water", closed: true })
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
    down("terrainBrush", 1, 1)
    up("terrainBrush", 1, 1)
    runToolAction("terrainBrush", "fill")
    expect(entities().map((e) => e.params.fill === true)).toEqual([false, true])
    expect(entities()[0].params).toMatchObject({ texture: "p|t1", base: "p|t0" })
  })
})

describe("effects, text, select, prefabs", () => {
  it("Environment writes the ambient light to the document", () => {
    useToolsStore.getState().selectToolById("environment")
    useToolsStore.getState().setToolParams("environment", { ambientLight: "#101020" })
    act("environment", (b, c) => b.onParamsChange?.(c, { ambientLight: "#101020" }))
    expect(useMapStore.getState().map?.environment.ambientLight).toBe("#101020")
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

  it("Text opens an editor; committing creates the label; Delete removes it", async () => {
    const { commitTextEdit } = await import("./text")
    useToolsStore.getState().selectToolById("text")
    down("text", 4, 4)
    up("text", 4, 4)
    const edit = useEditorStore.getState().textEdit
    expect(edit).toMatchObject({ entityId: null, position: { x: 4, y: 4 } })
    useEditorStore.getState().setTextEdit({ ...edit!, value: "Tavern" })
    commitTextEdit()
    expect(entities()[0]).toMatchObject({ toolId: "text", text: "Tavern" })
    expect(isToolActionDisabled("text", "delete")).toBe(false)
    runToolAction("text", "delete")
    expect(entities()).toEqual([])
  })

  it("Select picks, rubber-bands and drag-moves (one undo step)", () => {
    setParams("object", { [LIBRARY_PARAM]: ["p|a"] })
    down("object", 2, 2)
    down("object", 6, 6)
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
    down("object", 2, 2)
    useEditorStore.getState().select([entities()[0].id])
    useToolsStore.getState().selectToolById("prefabs")
    runToolAction("prefabs", "save")
    expect(useSettingsStore.getState().prefabs).toHaveLength(1)
    down("prefabs", 8, 8)
    expect(entities()).toHaveLength(2)
    expect(entities()[1].position).toEqual({ x: 8, y: 8 })
  })

  it("Select's corner handle scales from the opposite corner; the top handle rotates", () => {
    useViewStore.setState({ zoom: 100 })
    setParams("object", { [LIBRARY_PARAM]: ["p|a"] })
    down("object", 5, 5)
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
    down("object", 5, 5)
    useToolsStore.getState().selectToolById("select")
    useEditorStore.getState().select([entities()[0].id])
    down("select", 5, 4.5 - 24 / 64)
    move("select", 4.2, 4.5, { shiftKey: true })
    up("select", 4.2, 4.5)
    expect(entities()[0].rotation % 15).toBeCloseTo(0)
  })

  it("Select mirrors the selection with H/V and the panel buttons", () => {
    setParams("object", { [LIBRARY_PARAM]: ["p|a"], mirror: true })
    down("object", 2, 2)
    expect(entities()[0].flipX).toBe(true)
    down("object", 4, 2)
    useToolsStore.getState().selectToolById("select")
    expect(isToolActionDisabled("select", "flipH")).toBe(true)
    useEditorStore.getState().select(entities().map((e) => e.id))
    act("select", (b, c) => b.onKeyDown?.(c, { key: "h" } as KeyboardEvent))
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
