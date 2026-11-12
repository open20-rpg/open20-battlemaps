import { describe, expect, it } from "vitest"
import { pointInPolygon } from "./geometry"
import { blockingSegments, lightBlockers, visibilityPolygon } from "./lightBlock"
import { type MapEntity } from "./types"

const entity = (id: string, toolId: string, extra: Partial<MapEntity> = {}): MapEntity => ({
  id,
  toolId,
  layer: 100,
  position: { x: 0, y: 0 },
  rotation: 0,
  params: {},
  ...extra,
})
const room = entity("room", "wall", {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
})
const noSize = () => undefined

describe("light blocking", () => {
  it("keeps a light inside its room", () => {
    const poly = visibilityPolygon({ x: 5, y: 5 }, 20, blockingSegments([room], noSize))
    expect(pointInPolygon({ x: 9, y: 9 }, poly)).toBe(true)
    expect(pointInPolygon({ x: 12, y: 5 }, poly)).toBe(false)
  })

  it("casts a shadow behind a wall", () => {
    const wall = entity("w", "wall", {
      points: [
        { x: 4, y: -2 },
        { x: 4, y: 2 },
      ],
    })
    const poly = visibilityPolygon({ x: 0, y: 0 }, 10, blockingSegments([wall], noSize))
    expect(pointInPolygon({ x: 6, y: 0 }, poly)).toBe(false)
    expect(pointInPolygon({ x: 2, y: 0 }, poly)).toBe(true)
    // Around the wall's end, light goes on.
    expect(pointInPolygon({ x: 6, y: 5 }, poly)).toBe(true)
  })

  it("lets light out through an open portal, not a closed one", () => {
    const door = (blockLight: boolean) =>
      entity("d", "portal", { position: { x: 10, y: 5 }, rotation: 90, params: { blockLight } })
    const out = { x: 13, y: 5 }
    const open = blockingSegments([room, door(false)], noSize)
    expect(pointInPolygon(out, visibilityPolygon({ x: 5, y: 5 }, 20, open))).toBe(true)
    const shut = blockingSegments([room, door(true)], noSize)
    expect(pointInPolygon(out, visibilityPolygon({ x: 5, y: 5 }, 20, shut))).toBe(false)
  })

  it("only counts objects that block light", () => {
    const table = entity("t", "object", { params: { blockLight: false } })
    const crate = entity("c", "object", { params: { blockLight: true } })
    expect(lightBlockers([room, table, crate]).map((e) => e.id)).toEqual(["room", "c"])
  })
})
