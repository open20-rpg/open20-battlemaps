import { afterEach, describe, expect, it } from "vitest"
import { useMapStore } from "../../../src/stores/mapStore"
import { useEditorStore } from "../../../src/stores/editorStore"
import { propertiesOf, propertyPatches } from "../../../src/features/tools/properties"
import { extensionBridge } from "../../../src/features/map/render/extensionRender"
import { createRenderBridge } from "../../../src/features/extensions/renderBridge"
import { setExtensionRenderBridge } from "../../../src/features/map/render/extensionRender"
import { syncExtensionTools } from "../../../src/features/extensions/tools"
import { useExtensionsStore } from "../../../src/stores/extensionsStore"
import { updateEntities, addEntity, undo } from "../../../src/features/map/commands"
import { contribution, startExample } from "../testing"
import manifest from "./manifest.json"
import tint from "./src/main"

let stop: (() => void) | undefined
afterEach(() => stop?.())

const object = (id: string) => ({
  id,
  toolId: "object",
  layer: 100,
  level: "level-1",
  position: { x: 2, y: 2 },
  rotation: 0,
  params: { asset: "pack|textures/objects/barrel.png", color: "" },
})

describe("tint example", () => {
  it("adds a Tint property that writes the extension's data", async () => {
    const { h } = await startExample(tint, manifest)
    stop = () => h.stop()
    syncExtensionTools(useExtensionsStore.getState().contributions)
    addEntity(object("a"))
    const e = useMapStore.getState().map!.entities[0]
    const prop = propertiesOf("object").find((p) => p.spec.paramKey === "open20.tint:tint")
    expect(prop).toBeDefined()
    updateEntities(propertyPatches([e], "open20.tint:tint", "#00ff00"))
    expect(useMapStore.getState().map!.entities[0].ext).toEqual({
      "open20.tint": { tint: "#00ff00" },
    })
  })

  it("paints tinted entities through a data-driven rule", async () => {
    const { h } = await startExample(tint, manifest)
    stop = () => h.stop()
    setExtensionRenderBridge(createRenderBridge(h.services))
    addEntity({ ...object("a"), ext: { "open20.tint": { tint: "#123456", alpha: 0.5 } } })
    const e = useMapStore.getState().map!.entities[0]
    expect(extensionBridge()!.styleFor(e)).toMatchObject({ tint: "#123456", alpha: 0.5 })
    setExtensionRenderBridge(null)
  })

  it("tints the selection as one undo step, and selects what's tinted", async () => {
    const { h, ctx } = await startExample(tint, manifest)
    stop = () => h.stop()
    addEntity(object("a"))
    addEntity(object("b"))
    useEditorStore.getState().select(["a"])
    await contribution("command", "tint-red").run()
    await h.flush()
    expect(useMapStore.getState().map!.entities.find((e) => e.id === "a")?.ext).toEqual({
      "open20.tint": { tint: "#a70909" },
    })
    const ids = await contribution("selectionMode", "tinted").select([])
    expect(ids).toEqual(["a"])
    const a = await ctx.map.entity("a")
    await contribution("contextMenu", "clear-tint").run({ entities: [a!], at: { x: 0, y: 0 } })
    expect(useMapStore.getState().map!.entities[0].ext).toBeUndefined()
    undo()
    expect(useMapStore.getState().map!.entities[0].ext).toEqual({
      "open20.tint": { tint: "#a70909" },
    })
  })
})
