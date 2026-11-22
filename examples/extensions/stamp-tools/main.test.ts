import { afterEach, describe, expect, it } from "vitest"
import { useMapStore } from "../../../src/stores/mapStore"
import { useEditorStore } from "../../../src/stores/editorStore"
import { useToolsStore } from "../../../src/stores/toolsStore"
import { useExtensionsStore } from "../../../src/stores/extensionsStore"
import { useViewStore } from "../../../src/stores/viewStore"
import { syncExtensionTools } from "../../../src/features/extensions/tools"
import { getToolBehavior } from "../../../src/features/tools/behaviors"
import { buildToolCtx } from "../../../src/features/tools/behaviors/context"
import { EXTENSIONS_GROUP_ID } from "../../../src/features/tools/definitions"
import { undo } from "../../../src/features/map/commands"
import { contribution, startExample } from "../testing"
import manifest from "./manifest.json"
import stamps, { posts } from "./src/main"

let stop: (() => void) | undefined
afterEach(() => stop?.())
const entities = () => useMapStore.getState().map!.entities
const ptr = (x: number, y: number, extra = {}) => ({ x, y, button: 0, buttons: 1, shiftKey: false, altKey: false, ctrlKey: false, ...extra })

/** A key event as tools get it (node has no KeyboardEvent). */
const key = (k: string) =>
  ({ key: k, code: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }) as KeyboardEvent

async function setup() {
  const r = await startExample(stamps, manifest)
  stop = () => r.h.stop()
  syncExtensionTools(useExtensionsStore.getState().contributions)
  return r
}

describe("stamp tools", () => {
  it("puts its tools in the palette: in core groups and an Extensions group", async () => {
    await setup()
    const tree = useToolsStore.getState().tree
    const objects = tree.find((n) => n.id === "objects")
    expect(objects?.type === "group" && objects.children.some((c) => c.id === "ext:open20.stamp-tools/stamp")).toBe(true)
    const ext = tree.find((n) => n.id === EXTENSIONS_GROUP_ID)
    expect(ext?.type === "group" && ext.children.map((c) => c.id)).toEqual(["ext:open20.stamp-tools/room", "ext:open20.stamp-tools/ruler"])
  })

  it("stamps on click through the app's own tool input", async () => {
    const { h } = await setup()
    const id = "ext:open20.stamp-tools/stamp"
    useToolsStore.getState().selectToolById(id)
    const b = getToolBehavior(id)!
    b.onPointerUp!(buildToolCtx(id)!, ptr(3.2, 4.1, { buttons: 0 }))
    await h.flush()
    expect(entities()).toHaveLength(1)
    expect(entities()[0].position).toEqual({ x: 3, y: 4 })
  })

  it("builds a grouped palisade from a polyline, posts attached to it", async () => {
    const { h, ctx } = await setup()
    await contribution("tool", "palisade").onShape!({ toolId: "p", params: {}, level: "level-1", snap: true }, { gesture: "polyline", points: [{ x: 0, y: 0 }, { x: 3, y: 0 }] })
    await h.flush()
    const [wall, ...rest] = entities()
    expect(rest).toHaveLength(posts([{ x: 0, y: 0 }, { x: 3, y: 0 }]).length)
    expect(rest.every((e) => e.parent === wall.id && e.group === wall.group)).toBe(true)
    await ctx.map.apply([{ op: "move", ids: [wall.id], delta: { x: 0, y: 1 } }])
    expect(entities()[1].position.y).toBe(1)
    const prims = await contribution("wallStyle", "palisade").render((await ctx.map.entity(wall.id))!)
    expect(prims.length).toBeGreaterThan(5)
  })

  it("drags rooms, linked, and paints trails from brush strokes", async () => {
    const { h } = await setup()
    const room = "ext:open20.stamp-tools/room"
    useToolsStore.getState().selectToolById(room)
    const b = getToolBehavior(room)!
    const c = buildToolCtx(room)!
    b.onPointerDown!(c, ptr(1, 1))
    b.onPointerMove!(c, ptr(4, 3))
    expect(useEditorStore.getState().draft[0]?.kind).toBe("polygon")
    b.onPointerUp!(c, ptr(4, 3, { buttons: 0 }))
    await h.flush()
    const [floor, wall] = entities()
    expect(floor.toolId).toBe("build")
    expect(floor.link).toBe(wall.link)
    await contribution("tool", "trail").onShape!({ toolId: "t", params: { size: 1 }, level: "level-1", snap: false }, { gesture: "brush", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], radius: 1 })
    expect(entities().some((e) => e.toolId === "path")).toBe(true)
  })

  it("measures with raw pointer events, keys, a button and its own draft", async () => {
    const { h } = await setup()
    const id = "ext:open20.stamp-tools/ruler"
    useToolsStore.getState().selectToolById(id)
    const b = getToolBehavior(id)!
    const c = buildToolCtx(id)!
    b.onActivate!(c)
    b.onPointerDown!(c, ptr(0, 0))
    b.onPointerMove!(c, ptr(3, 4))
    await h.flush()
    expect(useExtensionsStore.getState().draft[1]).toMatchObject({ type: "text", text: "5.0" })
    expect(useExtensionsStore.getState().cursor).toBe("crosshair")
    expect(b.onKeyDown!(c, key("Escape"))).toBe(true)
    expect(b.onKeyDown!(c, key("x"))).toBe(false)
    await h.flush()
    expect(useExtensionsStore.getState().draft).toEqual([])
    b.onAction!(c, "clear")
    b.onParamsChange!(c, { unit: "feet" })
    b.onDeactivate!(c)
    await h.flush()
    expect(useExtensionsStore.getState().cursor).toBeNull()
  })

  it("extends Scatter, brushes, paths and terrain", async () => {
    await setup()
    expect((await contribution("scatterDistribution", "even").points({ x: 0, y: 0, w: 5, h: 5 }, 1, 9)).length).toBeGreaterThan(3)
    expect(contribution("brushTip", "chalk").dynamics?.size).toEqual([0.5, 1])
    expect(await contribution("pathStyle", "river").route!({ x: 0, y: 0 }, { x: 4, y: 2 })).toContainEqual({ x: 0, y: 0 })
    const w = await contribution("terrainRule", "highlands").weights({ x: 3, y: 3 }, 4)
    expect(w).toHaveLength(4)
  })

  it("tidies the selection with map ops in one step and frames it", async () => {
    const { h, ctx } = await setup()
    const ids = await ctx.map.add([{ kind: "object", position: { x: 2, y: 2 } }, { kind: "object", position: { x: 6, y: 4 } }])
    await ctx.editor.select(ids)
    const zoom = useViewStore.getState().zoom
    await contribution("command", "tidy").run()
    await h.flush()
    expect(entities().every((e) => e.locked)).toBe(true)
    expect(useViewStore.getState().zoom).not.toBe(zoom)
    undo()
    expect(entities().some((e) => e.locked)).toBe(false)
  })

  it("drives every map and editor operation", async () => {
    const { h, ctx } = await setup()
    const [a, b] = await ctx.map.add([
      { kind: "object", position: { x: 1, y: 1 }, asset: "p|a.png" },
      { kind: "object", position: { x: 2, y: 1 }, asset: "p|a.png" },
    ])
    await ctx.map.apply([
      { op: "update", id: a, patch: { rotation: 45, color: "#ff0000" } },
      { op: "replaceAsset", from: "p|a.png", to: "p|b.png" },
      { op: "group", ids: [a, b] },
      { op: "ungroup", ids: [a, b] },
      { op: "link", ids: [a, b] },
      { op: "unlink", ids: [a, b] },
      { op: "reorder", ids: [a], mode: "forward" },
      { op: "addLevel", name: "Sótano", id: "b1" },
      { op: "renameLevel", id: "b1", name: "Cripta" },
      { op: "setLevelData", id: "b1", data: { elevation: -1 } },
      { op: "moveLevel", id: "b1", dir: -1 },
      { op: "setAmbientLight", color: "#334455" },
      { op: "setBuildingWear", wear: "dust" },
      { op: "setPostProcess", values: { saturation: -0.5 } },
      { op: "resize", width: 30, height: 30 },
    ])
    const map = useMapStore.getState().map!
    expect(map.levels.map((l) => l.name)).toEqual(["Cripta", ""])
    expect(entities().every((e) => e.params.asset === "p|b.png")).toBe(true)
    expect(map).toMatchObject({ width: 30, buildingWear: "dust", environment: { ambientLight: "#334455" } })
    expect(await ctx.map.hitTest({ x: 1, y: 1 })).toContain(a)
    await ctx.editor.setLevel("b1")
    expect(useEditorStore.getState().activeLevel).toBe("b1")
    await ctx.editor.setLevel("level-1")
    await ctx.editor.setTool("ext:open20.stamp-tools/stamp", { scale: [1, 1] })
    await ctx.editor.setToolParams("ext:open20.stamp-tools/stamp", { scale: [2, 2] })
    expect(useToolsStore.getState().paramsByTool["ext:open20.stamp-tools/stamp"]?.scale).toEqual([2, 2])
    expect(await ctx.editor.copy([a])).toBe(1)
    const pasted = await ctx.editor.paste({ at: { x: 8, y: 8 } })
    expect(entities().find((e) => e.id === pasted[0])?.position).toEqual({ x: 8, y: 8 })
    await ctx.editor.camera({ center: { x: 5, y: 5 }, zoom: 200 })
    expect(useViewStore.getState().zoom).toBe(200)
    await ctx.map.remove([b])
    expect(entities().some((e) => e.id === b)).toBe(false)
    await ctx.map.apply([{ op: "removeLevel", id: "b1" }])
    expect((await ctx.map.history()).canUndo).toBe(true)
    await ctx.map.undo()
    expect(entities().some((e) => e.id === b)).toBe(false)
    await ctx.map.redo()
    await ctx.map.update(a, { position: { x: 9, y: 9 } })
    expect((await ctx.map.entity(a))?.position).toEqual({ x: 9, y: 9 })
    void h
  })

  it("clones, picks, steps through history and switches to a big stamp", async () => {
    const { h, ctx } = await setup()
    const [a] = await ctx.map.add([{ kind: "object", position: { x: 2, y: 2 } }])
    useEditorStore.getState().select([a])
    await contribution("command", "clone").run()
    expect(entities()).toHaveLength(2)
    expect(useEditorStore.getState().selection).not.toContain(a)
    useEditorStore.getState().setPointer({ x: 2, y: 2 })
    await contribution("command", "pick").run()
    expect(useEditorStore.getState().selection).toEqual([a])
    await contribution("command", "step-back").run()
    expect(entities()).toHaveLength(2)
    await contribution("command", "stamp-big").run()
    expect(useToolsStore.getState().paramsByTool["ext:open20.stamp-tools/stamp"]?.scale).toEqual([2, 2.5])
    void h
  })
})
