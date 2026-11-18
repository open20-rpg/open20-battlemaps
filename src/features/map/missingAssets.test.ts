import { describe, expect, it } from "vitest"
import {
  assetRefsOf,
  categoryOf,
  collectAssetIds,
  describeAssetId,
  findMissingAssets,
  isAssetId,
  replaceAssetIn,
  suggestQuery,
} from "./missingAssets"
import { type MapEntity } from "./model/types"

const DD_TABLE = "dungeondraft|textures/objects/furniture/table_round.png"
const DD_WALL = "dungeondraft|textures/walls/stone/wall.png"
const OK_TREE = "essentials|textures/objects/tree.png"

const entity = (
  id: string,
  toolId: string,
  params: MapEntity["params"],
  level = "L1",
): MapEntity => ({
  id,
  toolId,
  layer: 100,
  level,
  position: { x: 0, y: 0 },
  rotation: 0,
  params,
})

const ENTITIES: MapEntity[] = [
  entity("o1", "object", { asset: DD_TABLE }),
  entity("o2", "object", { asset: DD_TABLE }, "L2"),
  entity("o3", "object", { asset: OK_TREE }),
  entity("w1", "wall", { wall: { assets: [DD_WALL], color: "#fff" } }),
  entity("t1", "terrainBrush", {
    terrain: { width: 4, height: 4, slots: [OK_TREE, null, DD_TABLE], weights: "" },
  }),
  entity("txt", "text", { text: "a|textures/b" }),
]

const missing = (id: string) => id.startsWith("dungeondraft|")

describe("missing assets", () => {
  it("tells asset ids from other strings", () => {
    expect(isAssetId(DD_TABLE)).toBe(true)
    expect(isAssetId("dungeondraft|embedded://abc")).toBe(true)
    expect(isAssetId("a|textures b")).toBe(false)
    expect(isAssetId("hello|world")).toBe(false)
    expect(isAssetId(3)).toBe(false)
  })

  it("collects the ids of single assets, selections and terrain slots", () => {
    expect(assetRefsOf(ENTITIES[3])).toEqual([{ paramKey: "wall", id: DD_WALL }])
    expect(collectAssetIds(ENTITIES).sort()).toEqual([DD_TABLE, DD_WALL, OK_TREE].sort())
  })

  it("groups missing assets by id, most used first, with their entities and levels", () => {
    const list = findMissingAssets(ENTITIES, missing)
    expect(list.map((m) => m.id)).toEqual([DD_TABLE, DD_WALL])
    expect(list[0]).toMatchObject({
      name: "table round",
      source: "builtin",
      category: "objects",
      entityIds: ["o1", "o2", "t1"],
      levels: ["L1", "L2"],
    })
    expect(list[1]).toMatchObject({ name: "stone", category: "walls" })
  })

  it("picks the replacement category from the tool param the asset sits in", () => {
    const portal = entity("p", "portal", { asset: "dungeondraft|textures/portals/door.png" })
    expect(categoryOf(portal, "asset", portal.params.asset as string)).toBe("portals")
    const pattern = entity("pt", "pattern", { pattern: { assets: ["x|textures/tilesets/a.png"] } })
    expect(categoryOf(pattern, "pattern", "x|textures/tilesets/a.png")).toBe("tilesets")
    const unknown = entity("u", "nope", { asset: "x|textures/lights/l.png" })
    expect(categoryOf(unknown, "asset", "x|textures/lights/l.png")).toBe("lights")
  })

  it("suggests a Library search from the missing asset's name", () => {
    expect(suggestQuery("barrel 01")).toBe("barrel")
    expect(suggestQuery("table round wood")).toBe("table")
    expect(suggestQuery("01 x")).toBe("")
  })

  it("describes where an asset comes from", () => {
    expect(describeAssetId("dungeondraft|embedded://img_1")).toMatchObject({ source: "embedded" })
    expect(describeAssetId("abcd|textures/caves/dark_cave/floor.png")).toEqual({
      name: "dark cave",
      source: "pack",
      packId: "abcd",
    })
  })

  it("replaces an asset in every place an entity holds it", () => {
    expect(replaceAssetIn(ENTITIES[0], DD_TABLE, OK_TREE).params.asset).toBe(OK_TREE)
    const terrain = replaceAssetIn(ENTITIES[4], DD_TABLE, OK_TREE).params.terrain as {
      slots: unknown[]
    }
    expect(terrain.slots).toEqual([OK_TREE, null, OK_TREE])
    const both = entity("s", "scatter", { assets: { assets: [DD_TABLE, OK_TREE], color: "#fff" } })
    expect(
      (replaceAssetIn(both, DD_TABLE, OK_TREE).params.assets as { assets: string[] }).assets,
    ).toEqual([OK_TREE])
    expect(replaceAssetIn(ENTITIES[2], DD_TABLE, OK_TREE)).toBe(ENTITIES[2])
  })
})
