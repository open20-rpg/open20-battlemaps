import { describe, expect, it } from "vitest"
import { createTestHost } from "@open20/battlemaps-sdk/testing"
import manifest from "./manifest.json"
import tint from "./src/main"

/**
 * The same extension tested the way an author outside this repo would: with
 * the SDK's own test host (in memory, same protocol and permission checks).
 */
describe("tint with the SDK's test host", () => {
  it("tints the selection", async () => {
    const host = createTestHost({ permissions: manifest.permissions as never, manifest: manifest as never })
    const ctx = await host.load(tint)
    const [id] = await ctx.map.add([{ kind: "object", position: { x: 1, y: 1 } }])
    await ctx.editor.select([id])
    await host.contribution("command", "tint-red").run()
    expect(host.entities()[0].data).toEqual({ tint: "#a70909" })
    host.stop()
  })

  it("tells the user to select something first", async () => {
    const host = createTestHost({ permissions: manifest.permissions as never, manifest: manifest as never })
    await host.load(tint)
    await host.contribution("command", "tint-red").run()
    expect(host.notifications).toEqual(["Seleccioná algo primero"])
    host.stop()
  })
})
