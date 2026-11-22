import { afterEach, describe, expect, it } from "vitest"
import { defineExtension, type ExtensionContext } from "@open20/battlemaps-sdk"
import { useMapStore } from "../../stores/mapStore"
import { useEditorStore } from "../../stores/editorStore"
import { useExtensionsStore } from "../../stores/extensionsStore"
import { addEntity, undo, redo } from "../map/commands"
import { createHarness, type Harness } from "./testHarness"

let h: Harness
afterEach(() => h?.stop())

/** Start an extension that hands its context out, to drive it from the test. */
async function withContext(
  permissions: Parameters<Harness["start"]>[1]["permissions"],
  extra = {},
) {
  let ctx!: ExtensionContext
  await h.start(defineExtension({ activate: (c) => void (ctx = c) }), { permissions, ...extra })
  return ctx
}

const entities = () => useMapStore.getState().map!.entities

describe("extension host", () => {
  it("applies ops as one undo step through the commands", async () => {
    h = createHarness()
    const ctx = await withContext(["map:read", "map:write"])
    const ids = await ctx.map.add([
      { kind: "object", position: { x: 1, y: 1 }, asset: "p|a.png" },
      { kind: "object", position: { x: 2, y: 1 }, asset: "p|a.png" },
    ])
    expect(ids).toHaveLength(2)
    expect(entities()).toHaveLength(2)
    expect(useMapStore.getState().map!.extensions).toBeUndefined()
    undo()
    expect(entities()).toHaveLength(0)
    redo()
    expect(entities()).toHaveLength(2)
    expect((await ctx.map.query()).map((e) => e.id)).toEqual(ids)
  })

  it("rejects calls without the permission, and logs them", async () => {
    h = createHarness()
    const ctx = await withContext(["map:read"])
    await expect(ctx.map.add([{ kind: "object", position: { x: 0, y: 0 } }])).rejects.toMatchObject(
      {
        code: "permission",
      },
    )
    expect(entities()).toHaveLength(0)
    expect(useExtensionsStore.getState().activity.some((a) => a.kind === "denied")).toBe(true)
  })

  it("records the extension in the map when it stores data there", async () => {
    h = createHarness()
    const ctx = await withContext(["map:read", "map:write"])
    const [id] = await ctx.map.add([
      { kind: "object", position: { x: 0, y: 0 }, data: { tint: "#f00" } },
    ])
    expect(useMapStore.getState().map!.extensions).toEqual([{ id: "test.ext", version: "1.0.0" }])
    expect((await ctx.map.entity(id))?.data).toEqual({ tint: "#f00" })
  })

  it("merges reactions into the user's undo step", async () => {
    h = createHarness()
    const ctx = await withContext(["map:read", "map:write"])
    await ctx.map.addReaction((c) =>
      c.added.length
        ? c.added.map((id) => ({ op: "setData" as const, id, data: { seen: true } }))
        : [],
    )
    addEntity({
      id: "u1",
      toolId: "object",
      layer: 100,
      level: "level-1",
      position: { x: 0, y: 0 },
      rotation: 0,
      params: {},
    })
    await h.flush()
    expect(entities()[0].ext).toEqual({ "test.ext": { seen: true } })
    undo()
    expect(entities()).toHaveLength(0)
  })

  it("undoes a change a validator vetoes, and drops it from redo", async () => {
    h = createHarness()
    const ctx = await withContext(["map:read", "map:write"])
    await ctx.map.addValidator((_c, list) =>
      list.some((e) => e.kind === "light") ? { veto: "nada de luces" } : null,
    )
    addEntity({
      id: "l1",
      toolId: "light",
      layer: 700,
      level: "level-1",
      position: { x: 0, y: 0 },
      rotation: 0,
      params: {},
    })
    await h.flush()
    expect(entities()).toHaveLength(0)
    expect(useMapStore.temporal.getState().futureStates).toHaveLength(0)
  })

  it("sends map and editor events the extension subscribed to", async () => {
    h = createHarness()
    const seen: string[] = []
    const ctx = await withContext(["map:read", "map:write", "editor"])
    ctx.map.onChange((c) => seen.push(`map:${c.added.length}:${c.source}`))
    ctx.on("editor.selection", (s) => seen.push(`sel:${s.join(",")}`))
    await h.flush()
    addEntity({
      id: "x",
      toolId: "object",
      layer: 100,
      level: "level-1",
      position: { x: 0, y: 0 },
      rotation: 0,
      params: {},
    })
    useEditorStore.getState().select(["x"])
    await h.flush()
    expect(seen).toEqual(["map:1:null", "sel:x"])
  })

  it("registers contributions with their permission and drops them when stopped", async () => {
    h = createHarness()
    const ctx = await withContext(["ui"])
    await ctx.ui.command({ id: "hola", title: "Hola", run: () => {} })
    await expect(ctx.render.styleRule({ id: "r", match: {}, style: {} })).rejects.toMatchObject({
      code: "permission",
    })
    await expect(ctx.ui.command({ id: "hola", title: "Otra", run: () => {} })).rejects.toThrow(
      /already/,
    )
    await expect(
      ctx.ui.command({ id: "bad id!", title: "X", run: () => {} }),
    ).rejects.toMatchObject({ code: "invalid" })
    expect(useExtensionsStore.getState().contributions).toHaveLength(1)
    h.host.stop("test.ext")
    expect(useExtensionsStore.getState().contributions).toHaveLength(0)
    expect(useExtensionsStore.getState().status["test.ext"].status).toBe("inactive")
  })

  it("calls back into the extension (and times out politely)", async () => {
    h = createHarness()
    let ran = 0
    await h.start(
      defineExtension({
        activate: async (ctx) => {
          await ctx.ui.command({ id: "c", title: "C", run: () => void ran++ })
        },
      }),
      { permissions: ["ui"] },
    )
    const c = useExtensionsStore.getState().contributions[0].contribution
    if (c.type !== "command") throw new Error("not a command")
    await c.run()
    expect(ran).toBe(1)
  })

  it("asks the user through prompts and grants optional permissions", async () => {
    h = createHarness()
    const ctx = await withContext(["ui"], { optionalPermissions: ["clipboard"] })
    const asking = ctx.requestPermission("clipboard")
    await h.answer(true)
    expect(await asking).toBe(true)
    await ctx.clipboard.writeText("hola")
    expect(h.services.clipboard).toBe("hola")
    const confirm = ctx.ui.confirm("¿Seguro?", "Se borra todo")
    await h.answer(false)
    expect(await confirm).toBe(false)
    expect(h.services.registry[0]?.granted ?? []).toContain("clipboard")
  })

  it("keeps storage per extension and bounded", async () => {
    h = createHarness()
    const ctx = await withContext([])
    await ctx.storage.set("a", { n: 1 })
    expect(await ctx.storage.get("a")).toEqual({ n: 1 })
    expect(await ctx.storage.keys()).toEqual(["a"])
    await expect(ctx.storage.set("con espacios", 1)).rejects.toMatchObject({ code: "invalid" })
    await expect(ctx.storage.set("big", "x".repeat(1_100_000))).rejects.toMatchObject({
      code: "invalid",
    })
  })

  it("only fetches from granted hosts", async () => {
    h = createHarness()
    const ctx = await withContext(["network:api.example.com"])
    const res = await ctx.net.fetch("https://api.example.com/data")
    expect(res.status).toBe(200)
    await expect(ctx.net.fetch("https://evil.example.com/")).rejects.toMatchObject({
      code: "permission",
    })
    await expect(ctx.net.fetch("http://api.example.com/")).rejects.toMatchObject({
      code: "permission",
    })
    expect(h.services.fetched).toEqual(["https://api.example.com/data"])
  })

  it("keeps folder access inside the folder the user picked", async () => {
    h = createHarness()
    const ctx = await withContext(["folder"])
    await expect(ctx.folder.list()).rejects.toMatchObject({ code: "notFound" })
    expect(await ctx.folder.request()).toBe("carpeta")
    await ctx.folder.write("sub/a.txt", new Uint8Array([1]))
    await expect(ctx.folder.read("../secreto")).rejects.toMatchObject({ code: "invalid" })
    await expect(ctx.folder.read("/etc/passwd")).rejects.toMatchObject({ code: "invalid" })
  })

  it("renders the map to an image leaving out what the extension asks", async () => {
    h = createHarness()
    let hide: ((e: never) => boolean) | undefined
    h.host.hooks.renderToImage = async (opts) => {
      hide = opts.hide as never
      return new Uint8Array([1])
    }
    const ctx = await withContext(["map:read"])
    const img = await ctx.render.toImage({ hide: [{ kinds: ["object"] }] })
    expect(img.mime).toBe("image/png")
    expect(hide?.({ toolId: "object", params: {} } as never)).toBe(true)
    expect(hide?.({ toolId: "wall", params: {} } as never)).toBe(false)
  })
})
