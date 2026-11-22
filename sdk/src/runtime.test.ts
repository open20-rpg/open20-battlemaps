import { describe, expect, it } from "vitest"
import { defineExtension } from "./runtime"
import { createTestHost } from "./testing"
import { HostConnection } from "./hostkit"

describe("runtime + test host", () => {
  it("activates, calls host methods and reports permissions", async () => {
    const host = createTestHost({ permissions: ["map:read"] })
    let denied = ""
    await host.load(
      defineExtension({
        async activate(ctx) {
          expect(ctx.has("map:read")).toBe(true)
          expect(await ctx.map.get()).toMatchObject({ width: 20 })
          try {
            await ctx.map.add([{ kind: "object", position: { x: 1, y: 1 } }])
          } catch (e) {
            denied = (e as Error & { code: string }).code
          }
        },
      }),
    )
    expect(denied).toBe("permission")
    expect(host.entities()).toHaveLength(0)
  })

  it("turns functions into callbacks the host can call", async () => {
    const host = createTestHost({ permissions: ["tools", "map:write", "map:read"] })
    await host.load(
      defineExtension({
        async activate(ctx) {
          await ctx.tools.register({
            id: "stamp",
            name: "Sello",
            icon: "LuStamp",
            group: "objects",
            gesture: "click",
            onShape: async (_t, shape) => {
              await ctx.map.add([{ kind: "object", position: shape.points[0], asset: "a|b.png" }])
            },
          })
        },
      }),
    )
    const tool = host.contribution("tool", "stamp")
    await tool.onShape!(
      { toolId: "stamp", params: {}, level: "level-1", snap: true },
      { gesture: "click", points: [{ x: 3, y: 4 }] },
    )
    expect(host.entities()).toMatchObject([{ kind: "object", position: { x: 3, y: 4 } }])
  })

  it("withdraws contributions on dispose", async () => {
    const host = createTestHost({ permissions: ["ui"] })
    await host.load(
      defineExtension({
        async activate(ctx) {
          const d = await ctx.ui.command({ id: "x", title: "X", run: () => {} })
          d.dispose()
        },
      }),
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(host.contributions("command")).toHaveLength(0)
  })

  it("delivers subscribed events only", async () => {
    const host = createTestHost({ permissions: ["map:read", "map:write", "editor"] })
    const seen: string[] = []
    await host.load(
      defineExtension({
        async activate(ctx) {
          ctx.map.onChange((c) => seen.push(`changed:${c.added.length}`))
          await new Promise((r) => setTimeout(r, 0))
        },
      }),
    )
    await host.userApply([{ op: "add", entities: [{ kind: "object", position: { x: 0, y: 0 } }] }])
    host.emit("editor.selection", ["x"])
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual(["changed:1"])
  })

  it("runs reactions in the same step and validators that veto", async () => {
    const host = createTestHost({ permissions: ["map:read", "map:write"] })
    await host.load(
      defineExtension({
        async activate(ctx) {
          await ctx.map.addReaction(async (change) =>
            change.added.length && change.source === null
              ? [{ op: "setData", id: change.added[0], data: { tagged: true } }]
              : [],
          )
          await ctx.map.addValidator((_c, ents) =>
            ents.some((e) => e.kind === "light") ? { veto: "sin luces" } : null,
          )
        },
      }),
    )
    await host.userApply([{ op: "add", entities: [{ kind: "object", position: { x: 0, y: 0 } }] }])
    expect(host.entities()[0].data).toEqual({ tagged: true })
    await host.userApply([{ op: "add", entities: [{ kind: "light", position: { x: 1, y: 0 } }] }])
    expect(host.entities()).toHaveLength(1)
    expect(host.notifications).toContain("sin luces")
  })

  it("keeps storage, settings and translations per extension", async () => {
    const host = createTestHost({
      settings: { color: "#ff0000" },
      messages: { hello: "Hola {{name}}" },
    })
    await host.load(
      defineExtension({
        async activate(ctx) {
          await ctx.storage.set("k", { a: 1 })
          expect(await ctx.storage.get("k")).toEqual({ a: 1 })
          expect(ctx.settings.get()).toEqual({ color: "#ff0000" })
          await ctx.settings.set("color", "#00ff00")
          expect(ctx.settings.get().color).toBe("#00ff00")
          expect(ctx.t("hello", { name: "Ana" })).toBe("Hola Ana")
        },
      }),
    )
    expect(host.storage.get("k")).toEqual({ a: 1 })
  })

  it("asks for optional permissions only when declared", async () => {
    const host = createTestHost({ manifest: { optionalPermissions: ["clipboard"] } })
    await host.load(
      defineExtension({
        async activate(ctx) {
          expect(await ctx.requestPermission("folder")).toBe(false)
          expect(await ctx.requestPermission("clipboard")).toBe(true)
          expect(ctx.has("clipboard")).toBe(true)
        },
      }),
    )
  })
})

describe("HostConnection.allowed", () => {
  it("checks network permissions per URL", () => {
    const g = ["network:api.example.com" as const]
    expect(HostConnection.allowed("net.fetch", { url: "https://api.example.com/a" }, g)).toBe(true)
    expect(HostConnection.allowed("net.fetch", { url: "https://other.com/a" }, g)).toBe(false)
    expect(HostConnection.allowed("net.socketSend", { id: "s" }, g)).toBe(true)
    expect(HostConnection.allowed("net.socketSend", { id: "s" }, [])).toBe(false)
    expect(HostConnection.allowed("storage.get", { key: "a" }, [])).toBe(true)
    expect(HostConnection.allowed("map.apply", { ops: [] }, ["map:read"])).toBe(false)
  })
})
