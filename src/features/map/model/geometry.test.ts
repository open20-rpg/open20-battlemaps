import { describe, expect, it } from "vitest"
import {
  appendSample,
  boundsOf,
  closestOnSegment,
  distToPolyline,
  ellipsePolygon,
  entityBounds,
  entityHit,
  hitTest,
  nearestVertex,
  pointInPolygon,
  rectPolygon,
  rotateAround,
  snapPoint,
  textSize,
  translateEntity,
  wallPieces,
} from "./geometry"
import { createDocument, normalizeDocument, type MapEntity } from "./types"

const obj = (id: string, x: number, y: number, layer = 100): MapEntity => ({
  id,
  toolId: "object",
  layer,
  position: { x, y },
  rotation: 0,
  params: { asset: "p|textures/objects/a.png" },
})
const noSize = () => undefined

describe("geometry", () => {
  it("snaps to the step", () => {
    expect(snapPoint({ x: 1.26, y: -0.74 }, 0.5)).toEqual({ x: 1.5, y: -0.5 })
    expect(snapPoint({ x: 1.26, y: 2 }, 0)).toEqual({ x: 1.26, y: 2 })
  })

  it("rotates around a center", () => {
    const p = rotateAround({ x: 1, y: 0 }, { x: 0, y: 0 }, 90)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(1)
  })

  it("finds the closest point on a segment, clamped to its ends", () => {
    expect(closestOnSegment({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual({
      point: { x: 1, y: 0 },
      t: 0.5,
    })
    expect(closestOnSegment({ x: -3, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 }).t).toBe(0)
    expect(
      distToPolyline({ x: 1, y: 2 }, [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toBe(2)
  })

  it("tests points against polygons", () => {
    const square = rectPolygon({ x: 0, y: 0 }, { x: 2, y: 2 })
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true)
    expect(pointInPolygon({ x: 3, y: 1 }, square)).toBe(false)
    expect(boundsOf(ellipsePolygon({ x: 0, y: 0 }, { x: 4, y: 2 }))).toMatchObject({ w: 4 })
  })

  it("computes sprite bounds from the asset size and scale", () => {
    const e = { ...obj("a", 5, 5), scale: 2 }
    expect(entityBounds(e, () => ({ w: 1, h: 0.5 }))).toEqual({ x: 4, y: 4.5, w: 2, h: 1 })
    expect(entityBounds(obj("b", 0, 0), noSize)).toEqual({ x: -0.5, y: -0.5, w: 1, h: 1 })
  })

  it("estimates text footprints from the font size", () => {
    const t: MapEntity = {
      ...obj("t", 0, 0),
      toolId: "text",
      text: "abcd",
      params: { fontSize: 64 },
    }
    expect(textSize(t)).toEqual({ w: 2.4, h: 1.2 })
  })

  it("hit-tests the topmost entity (layer, then draw order)", () => {
    const entities = [obj("low", 0, 0, 100), obj("high", 0, 0, 200), obj("later", 0, 0, 100)]
    expect(hitTest(entities, { x: 0.1, y: 0.1 }, noSize)?.id).toBe("high")
    expect(hitTest(entities.slice(0, 1).concat(entities[2]), { x: 0, y: 0 }, noSize)?.id).toBe(
      "later",
    )
    expect(hitTest(entities, { x: 3, y: 3 }, noSize)).toBeUndefined()
  })

  it("hits brush strokes and polylines within their width", () => {
    const stroke: MapEntity = {
      ...obj("s", 0, 0),
      strokes: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
          ],
          radius: 1,
        },
      ],
    }
    expect(entityHit(stroke, { x: 2, y: 0.9 }, noSize)).toBe(true)
    expect(entityHit(stroke, { x: 2, y: 1.5 }, noSize)).toBe(false)
    const wall: MapEntity = {
      ...obj("w", 0, 0),
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
    }
    expect(entityHit(wall, { x: 2, y: 0.2 }, noSize)).toBe(true)
  })

  it("translates every coordinate of an entity", () => {
    const e: MapEntity = {
      ...obj("a", 1, 1),
      points: [{ x: 0, y: 0 }],
      strokes: [{ points: [{ x: 1, y: 1 }], radius: 1 }],
    }
    const moved = translateEntity(e, { x: 1, y: 2 })
    expect(moved.position).toEqual({ x: 2, y: 3 })
    expect(moved.points).toEqual([{ x: 1, y: 2 }])
    expect(moved.strokes?.[0].points).toEqual([{ x: 2, y: 3 }])
  })

  it("only appends brush samples that are far enough apart", () => {
    const pts = [{ x: 0, y: 0 }]
    expect(appendSample(pts, { x: 0.05, y: 0 }, 0.1)).toBe(pts)
    expect(appendSample(pts, { x: 0.2, y: 0 }, 0.1)).toHaveLength(2)
  })

  it("finds the nearest vertex within range", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]
    expect(nearestVertex(pts, { x: 1.9, y: 0.1 }, 0.5)).toBe(1)
    expect(nearestVertex(pts, { x: 1, y: 0 }, 0.5)).toBeUndefined()
  })
})

describe("document model", () => {
  it("creates a document with one level and a white environment", () => {
    const doc = createDocument(10, 8)
    expect(doc.levels).toHaveLength(1)
    expect(doc.environment.ambientLight).toBe("#ffffff")
    expect(doc.referenceImage).toBeNull()
  })

  it("upgrades old saves: levels/environment filled, entities put on the first level", () => {
    const doc = normalizeDocument({ width: 4, height: 4, entities: [obj("a", 0, 0)] })
    expect(doc.levels).toHaveLength(1)
    expect(doc.entities[0].level).toBe(doc.levels[0].id)
    expect(doc.environment.ambientLight).toBe("#ffffff")
  })
})

describe("wall pieces", () => {
  const square = rectPolygon({ x: 0, y: 0 }, { x: 4, y: 4 })

  it("keeps whole segments and flags corner ends", () => {
    const pieces = wallPieces(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
      false,
      [],
    )
    expect(pieces).toHaveLength(2)
    expect(pieces[0]).toMatchObject({ capA: false, capB: true })
    expect(pieces[1]).toMatchObject({ capA: true, capB: false })
    expect(wallPieces(square, true, []).every((p) => p.capA && p.capB)).toBe(true)
  })

  it("cuts an opening where a portal sits on the wall", () => {
    const pieces = wallPieces(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      false,
      [{ center: { x: 2, y: 0 }, width: 1 }],
    )
    expect(pieces.map((p) => [p.a.x, p.b.x])).toEqual([
      [0, 1.5],
      [2.5, 4],
    ])
    // Portals off the wall cut nothing.
    expect(
      wallPieces(
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
        ],
        false,
        [{ center: { x: 2, y: 1 }, width: 1 }],
      ),
    ).toHaveLength(1)
  })
})
