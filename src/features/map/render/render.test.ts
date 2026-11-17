import { describe, expect, it } from "vitest"
import { glowStrength, roofShade, shadeColor } from "./entities"
import { EXPORT_BAND_BYTES, exportBands, exportPxPerTile } from "./exportMap"
import {
  chaikinLoop,
  materialBorderPart,
  materialLoops,
  materialOrder,
  maskResolution,
  paintedGroups,
  paintedLayer,
} from "./painted"
import { emptyGrid, MATERIAL_CELLS_PER_TILE, stamp } from "./cells"
import { type MapEntity } from "../model/types"
import { mapToScreen, panToPlace, screenToMap } from "./viewport"

describe("viewport", () => {
  it("zooming keeps the point under the cursor in place", () => {
    const size = [800, 600, 30, 20] as const
    const cursor = { x: 610, y: 140 }
    const under = screenToMap(cursor, ...size, 100, { x: 40, y: -25 })
    const pan = panToPlace(under, cursor, ...size, 200)
    const after = screenToMap(cursor, ...size, 200, pan)
    expect(after.x).toBeCloseTo(under.x)
    expect(after.y).toBeCloseTo(under.y)
  })

  it("screenToMap inverts mapToScreen (mirrored x)", () => {
    const args = [800, 600, 30, 20, 150, { x: 40, y: -25 }] as const
    const p = { x: 7.25, y: 3.5 }
    const s = mapToScreen(p, ...args)
    const back = screenToMap(s, ...args)
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
    // Map x grows leftward on screen.
    expect(mapToScreen({ x: 1, y: 0 }, ...args).x).toBeLessThan(
      mapToScreen({ x: 0, y: 0 }, ...args).x,
    )
  })
})

describe("export", () => {
  it("caps the resolution so the image fits the max size", () => {
    expect(exportPxPerTile(256, 20, 10)).toBe(256)
    expect(exportPxPerTile(256, 100, 40)).toBe(81)
  })

  it("splits the export into full-width bands, each within the byte budget", () => {
    const bands = exportBands(8192, 8192)
    // 16 MB / (8192 px × 4 bytes) = 512 rows per band.
    expect(bands[0]).toEqual([0, 512])
    expect(bands).toHaveLength(16)
    expect(bands.every(([, h]) => 8192 * h * 4 <= EXPORT_BAND_BYTES)).toBe(true)
    const tail = exportBands(1000, 5000)
    expect(tail.reduce((a, [, h]) => a + h, 0)).toBe(5000)
    expect(tail.at(-1)?.[0]).toBe(4194)
  })
})

describe("renderers", () => {
  it("fades the light glow out as the ambient darkens", () => {
    expect(glowStrength("#ffffff")).toBeCloseTo(1)
    expect(glowStrength("#000000")).toBe(0)
    expect(glowStrength("#808080")).toBeLessThan(0.15)
  })

  it("shades roof faces by their angle to the sun", () => {
    expect(roofShade(45, 45, 0.4)).toBeCloseTo(1)
    expect(roofShade(225, 45, 0.4)).toBeCloseTo(0.6)
    expect(shadeColor(0xffffff, 0.5)).toBe(0x808080)
  })

  it("sizes painted masks within GPU limits and maps tools to layers", () => {
    expect(maskResolution({ width: 30, height: 30 })).toBe(32)
    expect(maskResolution({ width: 400, height: 100 })).toBe(5)
    expect(maskResolution({ width: 100, height: 80 })).toBe(20)
    expect(maskResolution({ width: 5000, height: 10 })).toBe(4)
    expect(paintedLayer("cave", [])).toBe(-300)
  })
})

describe("asset paths", () => {
  it("derives sibling and suffixed files next to an asset", async () => {
    const { relatedPath } = await import("./assets")
    expect(relatedPath("/p/textures/walls/stone.png", { suffix: "_end" })).toBe(
      "/p/textures/walls/stone_end.png",
    )
    expect(relatedPath("C:\\p\\caves\\rock\\floor.png", { part: "wall" })).toBe(
      "C:\\p\\caves\\rock\\wall.png",
    )
  })
})

describe("materials (material meshes)", () => {
  it("finds the border next to a tile texture by name", () => {
    expect(materialBorderPart("pack|textures/materials/cobblestone_tile.png")).toBe(
      "cobblestone_border",
    )
    expect(materialBorderPart("pack|textures/materials/grass_tile_1.png")).toBe("grass_border_1")
    expect(materialBorderPart("pack|textures/materials/plain.png")).toBeUndefined()
  })

  it("cuts every corner of a closed loop at its quarters", () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    const out = chaikinLoop(sq)
    expect(out).toHaveLength(8)
    expect(out[0]).toEqual({ x: 1, y: 0 })
    expect(out[1]).toEqual({ x: 3, y: 0 })
    expect(out[7]).toEqual({ x: 0, y: 1 })
  })

  it("orients outlines so the material is always on the same side", () => {
    const area = (l: { x: number; y: number }[]) =>
      l.reduce((a, p, i) => {
        const q = l[(i + 1) % l.length]
        return a + (p.x - q.x) * (p.y + q.y)
      }, 0)
    // A ring: 7×7 stamp with its 3×3 middle cleared → an outline and a hole.
    const g = emptyGrid(6, 6, MATERIAL_CELLS_PER_TILE)
    stamp(g, { x: 3, y: 3 }, 11, 1)
    stamp(g, { x: 3.1, y: 3.1 }, 3, 0)
    const loops = materialLoops(g)
    expect(loops).toHaveLength(2)
    const signs = loops.map((l) => Math.sign(area(l)))
    expect(signs[0]).toBe(-signs[1])
  })

  it("draws materials in first-painted order, Move to Front lifting one over the rest", () => {
    const e = (asset: string, toFront = false) =>
      ({
        params: { material: { assets: [asset] }, ...(toFront ? { toFront } : {}) },
      }) as unknown as MapEntity
    const order = (list: MapEntity[]) => materialOrder(list).map(([id, l]) => `${id}:${l.length}`)
    expect(order([e("a"), e("b"), e("a")])).toEqual(["a:2", "b:1"])
    expect(order([e("a"), e("b"), e("a", true)])).toEqual(["b:1", "a:2"])
    expect(order([e("a"), e("b"), e("a", true), e("b")])).toEqual(["b:2", "a:2"])
  })

  it("keeps one composite per material layer", () => {
    const e = (layer: number) => ({ layer }) as MapEntity
    const groups = paintedGroups("material", [e(-400), e(100), e(-400)])
    expect(groups.map((g) => [g.key, g.entities.length])).toEqual([
      ["material@-400", 2],
      ["material@100", 1],
    ])
    expect(paintedGroups("cave", [e(-300), e(-300)])).toHaveLength(1)
    expect(paintedGroups("water", [])).toEqual([])
  })
})
