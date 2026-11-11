import { describe, expect, it } from "vitest"
import { roofShade, shadeColor, smoothPolyline } from "./entities"
import { exportPxPerTile } from "./exportMap"
import { maskResolution, paintedLayer, terrainStrength } from "./painted"
import { mapToScreen, screenToMap } from "./viewport"

describe("viewport", () => {
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
})

describe("renderers", () => {
  it("shades roof faces by their angle to the sun", () => {
    expect(roofShade(45, 45, 0.4)).toBeCloseTo(1)
    expect(roofShade(225, 45, 0.4)).toBeCloseTo(0.6)
    expect(shadeColor(0xffffff, 0.5)).toBe(0x808080)
  })

  it("smooths polylines with Chaikin, keeping the endpoints", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]
    expect(smoothPolyline(pts, 0)).toBe(pts)
    const smooth = smoothPolyline(pts, 2)
    expect(smooth.length).toBeGreaterThan(pts.length)
    expect(smooth[0]).toEqual(pts[0])
    expect(smooth[smooth.length - 1]).toEqual(pts[2])
  })

  it("sizes painted masks within GPU limits and maps tools to layers", () => {
    expect(maskResolution({ width: 30, height: 30 })).toBe(32)
    expect(maskResolution({ width: 400, height: 100 })).toBe(10)
    expect(maskResolution({ width: 5000, height: 10 })).toBe(4)
    // Default intensity nearly replaces the texture in one pass; low needs several.
    expect(terrainStrength(4)).toBeCloseTo(0.865, 2)
    expect(terrainStrength(0.2)).toBeLessThan(0.15)
    expect(terrainStrength(8)).toBeGreaterThan(0.98)
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
