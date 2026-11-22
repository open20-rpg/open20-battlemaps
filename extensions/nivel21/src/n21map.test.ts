import { describe, expect, it } from "vitest"
import {
  assetLabel,
  imageSize,
  isN21Map,
  mapWalls,
  portalKind,
  rotatedSize,
  tilesOf,
  toImageSpace,
  wallSegments,
} from "./n21map"
import { pngHeader } from "./testing"

describe("n21map", () => {
  it("names objects after their asset", () => {
    expect(assetLabel("pack|textures/objects/wooden_barrel-02.png")).toBe("Wooden barrel 02")
    expect(assetLabel(undefined)).toBe("Objeto")
  })

  it("reads image sizes from PNG, WebP and JPEG headers", () => {
    expect(imageSize(pngHeader(512, 256))).toEqual({ width: 512, height: 256 })
    const vp8l = new Uint8Array(30)
    vp8l.set([
      ...new TextEncoder().encode("RIFF"),
      0,
      0,
      0,
      0,
      ...new TextEncoder().encode("WEBPVP8L"),
    ])
    // 300 × 200: (w-1) in 14 bits, then (h-1).
    const bits = (300 - 1) | ((200 - 1) << 14)
    vp8l.set([bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >> 24) & 255], 21)
    expect(imageSize(vp8l)).toEqual({ width: 300, height: 200 })
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 100, 0, 200, 3, 0, 0, 0, 0, 0, 0,
    ])
    expect(imageSize(jpeg)).toEqual({ width: 200, height: 100 })
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it("measures tiles and turned boxes", () => {
    expect(tilesOf({ width: 512, height: 256 }, 1.5)).toEqual({ w: 3, h: 1.5 })
    expect(tilesOf(null, 2)).toEqual({ w: 2, h: 2 })
    const r = rotatedSize(2, 1, 90)
    expect(r.w).toBeCloseTo(1)
    expect(r.h).toBeCloseTo(2)
  })

  it("mirrors map x into image space", () => {
    expect(toImageSpace({ x: 2, y: 3 }, 10)).toEqual({ x: 8, y: 3 })
  })

  it("cuts walls where doors and windows sit, keeping them as their own segments", () => {
    const segs = wallSegments(
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
      ],
      false,
      [
        { position: { x: 2, y: 0.1 }, width: 1, kind: "door" },
        { position: { x: 5, y: 0 }, width: 2, kind: "window" },
        { position: { x: 3, y: 2 }, width: 1, kind: "door" },
      ],
    )
    expect(segs.map((s) => [s.kind, s.a.x, s.b.x])).toEqual([
      ["wall", 0, 1.5],
      ["door", 1.5, 2.5],
      ["wall", 2.5, 4],
      ["window", 4, 6],
    ])
    expect(portalKind("p|portals/window_wide.png")).toBe("window")
    expect(portalKind("p|portals/door.png")).toBe("door")
  })

  it("closes closed walls and keeps segments in image space", () => {
    const walls = mapWalls(
      [
        {
          id: "w",
          kind: "wall",
          points: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
          ],
          closed: true,
        } as never,
      ],
      [],
      10,
    )
    expect(walls).toHaveLength(3)
    expect(walls[0]).toEqual({ x1: 10, y1: 0, x2: 8, y2: 0, kind: "wall" })
  })

  it("recognizes its own files", () => {
    expect(
      isN21Map({
        format: "open20.n21map",
        version: 1,
        grid: {},
        background: {},
        tokens: [],
        walls: [],
      }),
    ).toBe(true)
    expect(isN21Map({ format: "otro" })).toBe(false)
  })
})
