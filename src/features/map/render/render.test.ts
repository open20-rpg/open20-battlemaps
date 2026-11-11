import { describe, expect, it } from "vitest"
import { glowStrength, roofShade, shadeColor } from "./entities"
import { EXPORT_BAND_BYTES, exportBands, exportPxPerTile } from "./exportMap"
import { maskResolution, paintedLayer } from "./painted"
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
