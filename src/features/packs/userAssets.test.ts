import { describe, expect, it } from "vitest"
import {
  NO_ADJUST,
  categoryOfAssetId,
  cellsOf,
  fileName,
  groupFiles,
  nameFromFile,
  parseTags,
  scaleForCells,
  sharedValue,
  targetSize,
} from "./userAssets"

describe("file names", () => {
  it("reads paths and Android document URIs", () => {
    expect(fileName("/home/me/pics/chair.png")).toBe("chair.png")
    expect(fileName("C:\\maps\\door.webp")).toBe("door.webp")
    expect(
      fileName("content://com.android.providers/document/primary%3APictures%2Ftable.jpg"),
    ).toBe("table.jpg")
  })

  it("makes readable names", () => {
    expect(nameFromFile("/x/wooden_chair-02.png")).toBe("Wooden chair 02")
    expect(nameFromFile("/x/___.png")).toBe("Asset")
  })
})

describe("groupFiles", () => {
  it("keeps one item per image where there are no parts", () => {
    const g = groupFiles(["/a/chair.png", "/a/chair_end.png"], "objects")
    expect(g.map((x) => x.name)).toEqual(["Chair", "Chair end"])
  })

  it("pairs a wall with its end cap", () => {
    const g = groupFiles(["/w/stone_end.png", "/w/stone.png", "/w/brick.png"], "walls")
    expect(g).toEqual([
      { source: "/w/stone.png", name: "Stone", parts: { end: "/w/stone_end.png" } },
      { source: "/w/brick.png", name: "Brick", parts: {} },
    ])
  })

  it("pairs a material's tile and border and drops the marker", () => {
    const g = groupFiles(["/m/grass_tile.png", "/m/grass_border.png"], "materials")
    expect(g).toEqual([
      { source: "/m/grass_tile.png", name: "Grass", parts: { border: "/m/grass_border.png" } },
    ])
  })

  it("groups a cave's floor and wall by folder", () => {
    const g = groupFiles(["/c/Dark Cave/floor.png", "/c/Dark Cave/wall.png"], "caves")
    expect(g).toEqual([
      {
        source: "/c/Dark Cave/floor.png",
        name: "Dark Cave",
        parts: { wall: "/c/Dark Cave/wall.png" },
      },
    ])
  })

  it("groups roof parts by name prefix and keeps orphans", () => {
    const g = groupFiles(
      ["/r/slate_tiles.png", "/r/slate_edge.png", "/r/slate_ridge.png", "/r/moss_hip.png"],
      "roofs",
    )
    expect(g[0]).toEqual({
      source: "/r/slate_tiles.png",
      name: "Slate",
      parts: { edge: "/r/slate_edge.png", ridge: "/r/slate_ridge.png" },
    })
    expect(g[1].name).toBe("Moss hip")
  })
})

describe("sizes", () => {
  it("follows trim, rotation and scale", () => {
    expect(targetSize(400, 200, NO_ADJUST)).toEqual({ w: 400, h: 200 })
    expect(
      targetSize(400, 200, { ...NO_ADJUST, trim: true, rotate: 1, scale: 0.5 }, [0, 0, 200, 100]),
    ).toEqual({ w: 50, h: 100 })
    // Without bounds (a fully transparent image), trim keeps the size.
    expect(targetSize(10, 10, { ...NO_ADJUST, trim: true }, null)).toEqual({ w: 10, h: 10 })
  })

  it("converts between pixels and cells", () => {
    expect(cellsOf(512)).toBe(2)
    expect(cellsOf(300)).toBe(1.17)
    expect(scaleForCells(1024, 2)).toBe(0.5)
    expect(scaleForCells(0, 2)).toBe(1)
  })
})

describe("helpers", () => {
  it("finds shared values", () => {
    expect(sharedValue([{ a: 1 }, { a: 1 }], (x) => x.a)).toBe(1)
    expect(sharedValue([{ a: 1 }, { a: 2 }], (x) => x.a)).toBeUndefined()
    expect(sharedValue([], (x: { a: number }) => x.a)).toBeUndefined()
    expect(sharedValue([{ t: ["x"] }, { t: ["x"] }], (x) => x.t)).toEqual(["x"])
  })

  it("parses tags and asset categories", () => {
    expect(parseTags(" a, b ,, a,c ")).toEqual(["a", "b", "c"])
    expect(categoryOfAssetId("pk|textures/walls/x.webp")).toBe("walls")
    expect(categoryOfAssetId("pk|data/x")).toBeNull()
  })
})
