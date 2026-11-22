import { afterEach, describe, expect, it } from "vitest"
import { createHarness, type Harness } from "../../../src/features/extensions/testHarness"
import { useExtensionsStore } from "../../../src/stores/extensionsStore"
import { startExample } from "../../../examples/extensions/testing"
import manifest from "../manifest.json"
import nivel21 from "./main"
import { pngHeader } from "./testing"
import { isN21Map, type N21Map } from "./n21map"

let h: Harness
afterEach(() => h?.stop())

async function setup() {
  h = createHarness({ map: { width: 10, height: 8 } })
  let hidden: ((e: never) => boolean) | undefined
  h.host.hooks.renderToImage = async (opts) => {
    hidden = opts.hide as never
    return pngHeader(opts.pxPerTile! * 10, opts.pxPerTile! * 8)
  }
  // Barrels are 1×1 tile (256 px); the door 2 tiles wide.
  h.services.libraryImage = async (id) => ({
    name: "x.png",
    mime: "image/png",
    bytes: id.includes("door") ? pngHeader(512, 128) : pngHeader(256, 256),
  })
  const r = await startExample(nivel21, manifest, { harness: h })
  return { ...r, hidden: () => hidden }
}

const exportFormat = () =>
  useExtensionsStore.getState().contributions.find((c) => c.contribution.type === "exportFormat")!
    .contribution as Extract<
    ReturnType<typeof useExtensionsStore.getState>["contributions"][number]["contribution"],
    { type: "exportFormat" }
  >

describe("Nivel20 export", () => {
  it("exports the background without objects, objects as tokens and walls cut by the door", async () => {
    const { hidden } = await setup()
    const map = await import("../../../src/stores/mapStore")
    const commands = await import("../../../src/features/map/commands")
    commands.addEntities([
      {
        id: "b1",
        toolId: "object",
        layer: 100,
        level: "level-1",
        position: { x: 2, y: 2 },
        rotation: 0,
        params: { asset: "p|textures/objects/barrel.png" },
      },
      {
        id: "b2",
        toolId: "object",
        layer: 100,
        level: "level-1",
        position: { x: 3, y: 2 },
        rotation: 0,
        scale: 2,
        params: { asset: "p|textures/objects/barrel.png" },
      },
      {
        id: "w",
        toolId: "wall",
        layer: 600,
        level: "level-1",
        position: { x: 0, y: 4 },
        rotation: 0,
        points: [
          { x: 0, y: 4 },
          { x: 6, y: 4 },
        ],
        params: {},
      },
      {
        id: "d",
        toolId: "portal",
        layer: 500,
        level: "level-1",
        position: { x: 3, y: 4 },
        rotation: 0,
        params: { asset: "p|textures/portals/door.png" },
      },
    ])
    expect(map.useMapStore.getState().map!.entities).toHaveLength(4)
    const file = await exportFormat().export({
      profile: null,
      options: { pxPerCell: 70, name: "Cripta" },
    })
    expect(file.name).toBe("Cripta.n21map")
    const n21 = JSON.parse(new TextDecoder().decode(file.bytes)) as N21Map
    expect(isN21Map(n21)).toBe(true)
    expect(n21.grid).toEqual({ width: 10, height: 8, pxPerCell: 70, cellDistance: 5, unit: "ft" })
    expect(n21.background).toMatchObject({ width: 700, height: 560 })
    expect(hidden()?.({ toolId: "object", params: {} } as never)).toBe(true)
    expect(hidden()?.({ toolId: "wall", params: {} } as never)).toBe(false)
    // Two barrels, one image; the second twice as big; x mirrored to image space.
    expect(Object.keys(n21.images)).toHaveLength(1)
    expect(n21.tokens.map((t) => [t.name, t.x, t.y, t.width])).toEqual([
      ["Barrel", 8, 2, 1],
      ["Barrel", 7, 2, 2],
    ])
    expect(n21.walls.map((w) => [w.kind, w.x1, w.x2])).toEqual([
      ["wall", 10, 8],
      ["door", 8, 6],
      ["wall", 6, 4],
    ])
  })

  it("warns about objects whose image isn't installed", async () => {
    const { h } = await setup()
    h.services.libraryImage = async () => null
    const commands = await import("../../../src/features/map/commands")
    commands.addEntities([
      {
        id: "b1",
        toolId: "object",
        layer: 100,
        level: "level-1",
        position: { x: 2, y: 2 },
        rotation: 0,
        params: { asset: "p|gone.png" },
      },
    ])
    const file = await exportFormat().export({ profile: null, options: {} })
    const n21 = JSON.parse(new TextDecoder().decode(file.bytes)) as N21Map
    expect(n21.tokens).toHaveLength(0)
    await h.flush()
    expect(
      useExtensionsStore.getState().activity.some((a) => a.text.includes("1 objetos sin imagen")),
    ).toBe(true)
  })
})
