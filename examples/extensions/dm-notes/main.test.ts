import { afterEach, describe, expect, it } from "vitest"
import { useEditorStore } from "../../../src/stores/editorStore"
import { useExtensionsStore } from "../../../src/stores/extensionsStore"
import { useMapStore } from "../../../src/stores/mapStore"
import { addEntity, updateEntity } from "../../../src/features/map/commands"
import { computeStats } from "../../../src/features/extensions/actions"
import { frameBus } from "../../../src/features/extensions/host"
import { contribution, startExample } from "../testing"
import manifest from "./manifest.json"
import notes from "./src/main"

let stop: (() => void) | undefined
afterEach(() => stop?.())
const store = () => useExtensionsStore.getState()
const room = { id: "r", toolId: "build", layer: -200, level: "level-1", position: { x: 1, y: 1 }, rotation: 0, closed: true, points: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }], params: {} }

describe("DM notes", () => {
  it("writes notes from its declarative panel", async () => {
    const { h, ctx } = await startExample(notes, manifest)
    stop = () => h.stop()
    addEntity(room)
    await ctx.editor.select(["r"])
    const ui = await contribution("panel", "notes").render()
    if (ui.type !== "column") throw new Error("column")
    const field = ui.children.find((c) => c.type === "field")
    const button = ui.children.find((c) => c.type === "button")
    if (field?.type !== "field" || button?.type !== "button") throw new Error("parts")
    await field.onChange("Trampa de pinchos")
    await button.onClick()
    await h.flush()
    expect(useMapStore.getState().map!.entities[0].ext?.["open20.dm-notes"]).toEqual({ note: "Trampa de pinchos", dmOnly: true })
    expect(store().panels["open20.dm-notes::notes"].ui).not.toBeNull()
    expect(store().statusItems["open20.dm-notes::count"].text).toBe("Notas: 1")
    await contribution("statusItem", "count").onClick!()
    expect(store().panels["open20.dm-notes::notes"].open).toBe(true)
  })

  it("reveals rooms in the players' view, with fog", async () => {
    const { h } = await startExample(notes, manifest)
    stop = () => h.stop()
    addEntity(room)
    useEditorStore.getState().select(["r"])
    await contribution("command", "reveal").run()
    expect(store().panels["open20.dm-notes::view:players"].open).toBe(true)
    expect(store().overlays["open20.dm-notes::fog:players"].primitives).toHaveLength(1)
    await contribution("command", "close-view").run()
    expect(store().panels["open20.dm-notes::view:players"].open).toBe(false)
    expect(contribution("view", "players").fog).toBe(true)
  })

  it("talks to its sandboxed page", async () => {
    const { h } = await startExample(notes, manifest)
    stop = () => h.stop()
    const got: unknown[] = []
    frameBus.listeners.set("open20.dm-notes::summary", (m) => got.push(m))
    await contribution("iframePanel", "summary").onMessage!({ refresh: true })
    expect(got).toEqual([{ notes: 0 }])
    frameBus.listeners.delete("open20.dm-notes::summary")
  })

  it("vetoes empty notes, counts notes in stats, and clears them after asking", async () => {
    const { h } = await startExample(notes, manifest)
    stop = () => h.stop()
    addEntity(room)
    updateEntity("r", { ext: { "open20.dm-notes": { note: "" } } })
    await h.flush()
    expect(useMapStore.getState().map!.entities[0].ext).toBeUndefined()
    updateEntity("r", { ext: { "open20.dm-notes": { note: "Secreto", dmOnly: true } } })
    await h.flush()
    expect((await computeStats())[0].rows).toEqual([{ label: "Notas", value: "1" }, { label: "Secretas", value: "1" }])
    const clearing = contribution("command", "clear-notes").run()
    await h.answer("secret")
    await h.answer("limpieza")
    await h.answer(true)
    await clearing
    expect(useMapStore.getState().map!.entities[0].ext).toBeUndefined()
    expect(store().tour?.key).toBe("open20.dm-notes::tour:welcome")
    expect(store().activity.some((a) => a.text.includes("notes cleared"))).toBe(true)
  })
})
