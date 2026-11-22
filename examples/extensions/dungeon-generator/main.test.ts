import { afterEach, describe, expect, it } from "vitest"
import { useMapStore } from "../../../src/stores/mapStore"
import { addEntity, undo } from "../../../src/features/map/commands"
import { useExtensionsStore } from "../../../src/stores/extensionsStore"
import { contribution, startExample } from "../testing"
import manifest from "./manifest.json"
import dungeon, { dungeonOps, layout } from "./src/main"

let stop: (() => void) | undefined
afterEach(() => stop?.())
const entities = () => useMapStore.getState().map!.entities

describe("dungeon generator", () => {
  it("lays out the same dungeon for the same seed, rooms apart", () => {
    const a = layout({ x: 0, y: 0, w: 40, h: 30 }, 6, 42)
    expect(layout({ x: 0, y: 0, w: 40, h: 30 }, 6, 42)).toEqual(a)
    expect(a.rooms.length).toBeGreaterThanOrEqual(3)
    expect(dungeonOps({ x: 0, y: 0, w: 40, h: 30 }, 6, 42, true)[0]).toMatchObject({ op: "add" })
  })

  it("generates into the map as one undo step", async () => {
    const { h } = await startExample(dungeon, manifest)
    stop = () => h.stop()
    const g = contribution("generator", "dungeon")
    const ops = await g.generate({ params: { rooms: 4, torches: false }, seed: 7, area: null, selection: [], level: "level-1", size: { width: 20, height: 20 } })
    const { applyFor } = await import("../../../src/features/extensions/actions")
    applyFor("open20.dungeon-generator", ops)
    expect(entities().filter((e) => e.toolId === "build").length).toBeGreaterThan(1)
    expect((await g.preview!({ params: { rooms: 4 }, seed: 7, area: null, selection: [], level: "level-1" })).length).toBeGreaterThan(1)
    undo()
    expect(entities()).toHaveLength(0)
    expect(contribution("newMapPreset", "small-dungeon")).toMatchObject({ width: 30, generator: "dungeon" })
  })

  it("draws stairs from their data and resizes them by the handle", async () => {
    const { h, ctx } = await startExample(dungeon, manifest)
    stop = () => h.stop()
    const [id] = await ctx.map.add([{ kind: "ext:open20.dungeon-generator/stairs", position: { x: 2, y: 2 }, data: { steps: 3, width: 2 } }])
    const stairs = (await ctx.map.entity(id))!
    const t = contribution("entityType", "stairs")
    expect(await t.render(stairs)).toHaveLength(3)
    expect(await t.hitShape!(stairs)).toHaveLength(4)
    expect(await t.handles!(stairs)).toEqual([{ id: "end", position: { x: 4, y: 3.2 } }])
    const ops = await t.onHandle!(stairs, "end", { x: 5, y: 4 })
    await ctx.map.apply(ops)
    expect((await ctx.map.entity(id))!.data).toEqual({ steps: 5, width: 3 })
  })

  it("lights torches, straightens objects and counts floors in the user's step", async () => {
    const { h } = await startExample(dungeon, manifest)
    stop = () => h.stop()
    addEntity({ id: "t", toolId: "object", layer: 100, level: "level-1", position: { x: 3, y: 3 }, rotation: 80, params: { asset: "open20.essentials|textures/objects/torch.png" } })
    await h.flush()
    const light = entities().find((e) => e.toolId === "light")
    expect(light).toMatchObject({ parent: "t", position: { x: 3, y: 3 } })
    expect(entities().find((e) => e.id === "t")?.rotation).toBe(90)
    expect(useMapStore.getState().map!.ext?.["open20.dungeon-generator"]).toEqual({ floors: 0 })
    undo()
    expect(entities()).toHaveLength(0)
  })

  it("analyzes rooms, walkable cells, paths and visibility", async () => {
    const { h, ctx } = await startExample(dungeon, manifest)
    stop = () => h.stop()
    await ctx.map.apply(dungeonOps({ x: 1, y: 1, w: 18, h: 18 }, 3, 11, false))
    await contribution("command", "analyze").run()
    await h.flush()
    const log = useExtensionsStore.getState().activity.map((a) => a.text).join("\n")
    expect(log).toMatch(/notify: \d+ habitaciones/)
    expect(log).toMatch(/analysis.path|analysis.visibility/)
  })
})
