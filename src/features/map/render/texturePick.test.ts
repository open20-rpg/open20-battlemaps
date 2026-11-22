import { describe, expect, it } from "vitest"
import { type MapEntity } from "../model/types"
import { portalOpenings, texturePicker } from "./texturePick"

const entity = (e: Partial<MapEntity> & Pick<MapEntity, "toolId">): MapEntity => ({
  id: "e",
  layer: 0,
  position: { x: 0, y: 0 },
  rotation: 0,
  params: {},
  ...e,
})

const sizes =
  (s: Record<string, { w: number; h: number }>) =>
  (id: string): { w: number; h: number } | undefined =>
    s[id]

describe("texture picking (click through transparency)", () => {
  it("a sprite maps to its image, mirrored like the map; off it is null", () => {
    const e = entity({ toolId: "object", position: { x: 4, y: 4 }, params: { asset: "a" } })
    const pick = texturePicker(e, sizes({ a: { w: 2, h: 2 } }))
    expect(pick?.at({ x: 3.5, y: 4 })).toMatchObject({ asset: "a", u: 0.75, v: 0.5 })
    expect(pick?.at({ x: 6, y: 4 })).toBeNull()
  })

  it("a path maps along its strip (u repeats with the texture, v across)", () => {
    const e = entity({
      toolId: "path",
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      params: { asset: "p", width: 1 },
    })
    const pick = texturePicker(e, sizes({ p: { w: 2, h: 1 } }))
    // v = 0 on the left side (+normal: +y here), 1 on the right.
    const hit = pick?.at({ x: 2.5, y: 0.25 })
    expect(hit?.asset).toBe("p")
    expect(hit?.u).toBeCloseTo(0.25)
    expect(hit?.v).toBeCloseTo(0.25)
    // Off the strip: nothing is drawn there.
    expect(pick?.at({ x: 2, y: 0.7 })).toBeNull()
    // Its spread covers the strip, not its box.
    const spread = pick?.spread?.() ?? []
    expect(spread.length).toBeGreaterThan(100)
    expect(spread.every(({ p }) => Math.abs(p.y) <= 0.5 + 1e-9)).toBe(true)
    expect(spread.some(({ p }) => p.x > 3.9) && spread.some(({ p }) => p.x < 0.1)).toBe(true)
  })

  it("a path's fades lower the opacity at its ends", () => {
    const e = entity({
      toolId: "path",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      params: { asset: "p", transitionIn: "fade" },
    })
    const pick = texturePicker(e, sizes({ p: { w: 1, h: 1 } }))
    expect(pick?.at({ x: 0.05, y: 0 })?.opacity).toBeLessThan(0.2)
    expect(pick?.at({ x: 5, y: 0 })?.opacity).toBe(1)
  })

  it("a wall maps along its strip; off it (caps, reach) the shape decides", () => {
    const e = entity({
      toolId: "wall",
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      params: { wall: { assets: ["w"] } },
    })
    const sizeOf = sizes({ w: { w: 2, h: 0.5 }, d: { w: 1, h: 1 } })
    const hit = texturePicker(e, sizeOf)?.at({ x: 1, y: 0.1 })
    expect(hit?.u).toBeCloseTo(0.5)
    expect(hit?.v).toBeCloseTo(0.3)
    expect(texturePicker(e, sizeOf)?.at({ x: 1, y: 0.4 })).toBeUndefined()
    // A portal's opening isn't part of the strip.
    const door = entity({ toolId: "portal", position: { x: 2, y: 0 }, params: { asset: "d" } })
    expect(portalOpenings([door], sizeOf)).toEqual([{ center: { x: 2, y: 0 }, width: 1 }])
    expect(texturePicker(e, sizeOf, [door])?.at({ x: 2, y: 0 })).toBeUndefined()
    expect(texturePicker(e, sizeOf, [door])?.at({ x: 1, y: 0 })).toBeDefined()
  })

  it("a pattern tiles from its position (mirrored x); outside its shape is null", () => {
    const e = entity({
      toolId: "pattern",
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
      closed: true,
      params: { pattern: { assets: ["t"] } },
    })
    const pick = texturePicker(e, sizes({ t: { w: 2, h: 2 } }))
    expect(pick?.at({ x: 1, y: 0.5 })).toMatchObject({ asset: "t", u: 0.5, v: 0.25 })
    expect(pick?.at({ x: 5, y: 1 })).toBeNull()
  })

  it("untextured entities, or textures not loaded yet, have no picker", () => {
    expect(texturePicker(entity({ toolId: "light" }), sizes({}))).toBeUndefined()
    expect(texturePicker(entity({ toolId: "text" }), sizes({}))).toBeUndefined()
    const path = entity({ toolId: "path", points: [{ x: 0, y: 0 }], params: { asset: "p" } })
    expect(texturePicker(path, sizes({}))).toBeUndefined()
  })
})
