import { describe, expect, it } from "vitest"
import { entityAssetIds, usedAssetIds } from "./packUsage"
import { createDocument, type MapEntity } from "./model/types"

const e = (params: Record<string, unknown>): MapEntity => ({
  id: Math.random().toString(36),
  toolId: "object",
  layer: 0,
  position: { x: 0, y: 0 },
  rotation: 0,
  params,
})

describe("pack usage", () => {
  it("collects single assets and selections from entity params", () => {
    expect(
      entityAssetIds(
        e({
          asset: "p|textures/objects/a.png",
          wall: { assets: ["q|textures/walls/w.png"] },
          color: "#fff",
        }),
      ),
    ).toEqual(["p|textures/objects/a.png", "q|textures/walls/w.png"])
  })

  it("lists used assets of a category, deduplicated", () => {
    const doc = createDocument(5, 5)
    doc.entities = [
      e({ asset: "p|textures/objects/a.png" }),
      e({ asset: "p|textures/objects/a.png" }),
      e({ asset: "p|textures/paths/road.png" }),
    ]
    expect(usedAssetIds(doc, "objects")).toEqual(["p|textures/objects/a.png"])
    expect(usedAssetIds(doc, "paths")).toEqual(["p|textures/paths/road.png"])
    expect(usedAssetIds(null, "objects")).toEqual([])
  })
})
