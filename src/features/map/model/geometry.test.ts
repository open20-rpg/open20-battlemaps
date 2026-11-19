import { describe, expect, it } from "vitest"
import {
  bandTouchesSolid,
  joinPolylines,
  tangentArc,
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
  wallRuns,
  selectionBounds,
  transformHandles,
  scaleEntity,
  isStretchable,
  isSelectable,
  flipEntity,
  transformEntity,
  normalizeDegrees,
  spriteCorners,
  spriteUV,
} from "./geometry"
import { createDocument, normalizeDocument, type MapEntity, type Vec2 } from "./types"

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

  it("frames a text from its top-left corner (screen-left is the larger map x)", () => {
    const t: MapEntity = {
      ...obj("t", 10, 10),
      toolId: "text",
      text: "abcd",
      params: { fontSize: 64 },
    }
    // Measured without a canvas: 0.55 em per letter, a quarter-em space.
    const { w, h } = textSize(t)
    expect(w).toBeCloseTo((4 * 64 * 0.55 + 16) / 64)
    expect(h).toBeCloseTo(1)
    expect(hitTest([t], { x: 10 - w / 2, y: 10.5 }, noSize)?.id).toBe("t")
    expect(hitTest([t], { x: 10 + 0.2, y: 10.5 }, noSize)).toBeUndefined()
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

describe("wall runs & strip outline", () => {
  const L = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
  ]

  it("keeps an uncut wall as one run (closed stays closed)", () => {
    expect(wallRuns(L, false, [])).toEqual([{ points: L, closed: false }])
    const square = rectPolygon({ x: 0, y: 0 }, { x: 4, y: 4 })
    expect(wallRuns(square, true, [])).toEqual([{ points: square, closed: true }])
  })

  it("splits runs at portal openings", () => {
    const runs = wallRuns(L, false, [{ center: { x: 2, y: 0 }, width: 1 }])
    expect(runs.map((r) => r.points)).toEqual([
      [
        { x: 0, y: 0 },
        { x: 1.5, y: 0 },
      ],
      [
        { x: 2.5, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
    ])
  })

  it("stitches a cut closed wall back across its first vertex", () => {
    const square = rectPolygon({ x: 0, y: 0 }, { x: 4, y: 4 })
    // Opening on the third side (x from 4 to 0 at y = 4).
    const runs = wallRuns(square, true, [{ center: { x: 2, y: 4 }, width: 1 }])
    expect(runs).toHaveLength(1)
    expect(runs[0].points[0]).toEqual({ x: 1.5, y: 4 })
    expect(runs[0].points[runs[0].points.length - 1]).toEqual({ x: 2.5, y: 4 })
  })
})

describe("openings next to a corner", () => {
  const room = rectPolygon({ x: 0, y: 0 }, { x: 4, y: 4 })
  const round = (p: Vec2) => ({ x: +p.x.toFixed(6), y: +p.y.toFixed(6) })
  const pts = (center: Vec2) =>
    wallRuns(room, true, [{ center, width: 1 }]).map((r) => r.points.map(round))

  it("doesn't join the run past a window that cuts the end of a side", () => {
    // A 1-tile window at x 3.2–4.2 on the top side: 0.2 of it sticks out past
    // the (4,0) corner and cuts the right side too.
    expect(pts({ x: 3.7, y: 0 })).toEqual([
      [
        { x: 4, y: 0.2 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
        { x: 0, y: 0 },
        { x: 3.2, y: 0 },
      ],
    ])
  })

  it("same next to vertex 0 (the closing seam), both ways", () => {
    // Right after vertex 0, on the first side.
    expect(pts({ x: 0.3, y: 0 })).toEqual([
      [
        { x: 0.8, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
        { x: 0, y: 0.2 },
      ],
    ])
    // Right before vertex 0, on the closing side (x = 0, going up).
    expect(pts({ x: 0, y: 0.3 })).toEqual([
      [
        { x: 0.2, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
        { x: 0, y: 0.8 },
      ],
    ])
  })

  it("an open wall: the corner piece doesn't hook onto a piece cut short", () => {
    const L = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]
    expect(
      wallRuns(L, false, [{ center: { x: 3.5, y: 0 }, width: 1 }]).map((r) => r.points),
    ).toEqual([
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
      ],
      [
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
    ])
  })
})

describe("wall picking", () => {
  const room: MapEntity = {
    id: "w",
    toolId: "wall",
    layer: 600,
    position: { x: 0, y: 0 },
    rotation: 0,
    points: rectPolygon({ x: 0, y: 0 }, { x: 6, y: 6 }),
    closed: true,
    params: {},
  }
  const floor: MapEntity = { ...room, id: "f", toolId: "build", layer: -200 }

  it("picks a closed wall only near its outline", () => {
    expect(entityHit(room, { x: 3, y: 3 }, noSize)).toBe(false)
    expect(entityHit(room, { x: 3, y: 0.1 }, noSize)).toBe(true)
  })

  it("lets clicks inside a room reach what is inside", () => {
    const chair = obj("chair", 3, 3, 100)
    expect(hitTest([floor, room, chair], { x: 3, y: 3 }, noSize)?.id).toBe("chair")
    expect(hitTest([floor, room], { x: 2, y: 2 }, noSize)?.id).toBe("f")
    expect(hitTest([floor, room], { x: 0, y: 3 }, noSize)?.id).toBe("w")
  })
})

describe("transform handles", () => {
  it("bounds a selection and places scale/rotate handles anchored on the opposite side", () => {
    const box = selectionBounds([obj("a", 0, 0), obj("b", 4, 2)], noSize)
    expect(box).toEqual({ x: -0.5, y: -0.5, w: 5, h: 3 })
    const h = transformHandles(box!, 0.01)
    expect(h.scale).toHaveLength(4)
    expect(h.scale[0]).toEqual({
      at: { x: -0.5, y: -0.5 },
      anchor: { x: 4.5, y: 2.5 },
      axis: "both",
    })
    expect(h.rotate).toEqual({ x: 2, y: -0.74 })
    const stretch = transformHandles(box!, 0.01, true)
    expect(stretch.scale).toHaveLength(8)
    expect(stretch.scale.find((s) => s.axis === "x" && s.at.x === -0.5)?.anchor).toEqual({
      x: 4.5,
      y: 1,
    })
    expect(selectionBounds([], noSize)).toBeNull()
  })

  it("scales away from a fixed anchor (one axis stretches only points)", () => {
    const wall: MapEntity = {
      ...obj("w", 0, 0),
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 1 },
      ],
    }
    const t = scaleEntity(wall, { x: 0, y: 0 }, 2, 1)
    expect(t.points).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 1 },
    ])
    const chair = { ...obj("c", 2, 2), scale: 1 }
    expect(scaleEntity(chair, { x: 0, y: 0 }, 2, 1).scale).toBe(1)
    const grown = scaleEntity(chair, { x: 0, y: 0 }, 1.5, 1.5)
    expect(grown.scale).toBe(1.5)
    expect(grown.position).toEqual({ x: 3, y: 3 })
    expect(isStretchable([chair])).toBe(false)
    expect(isStretchable([chair, wall])).toBe(true)
  })

  it("rotates and scales sprites around a center", () => {
    const e = { ...obj("a", 2, 0), rotation: 10, scale: 1 }
    const t = transformEntity(e, { x: 0, y: 0 }, 90, 2)
    expect(t.rotation).toBe(100)
    expect(t.scale).toBe(2)
    // 90° clockwise on screen = counter-clockwise in mirrored map space.
    expect(t.position.x).toBeCloseTo(0)
    expect(t.position.y).toBeCloseTo(-4)
  })

  it("moves polyline points and widens strokes", () => {
    const wall: MapEntity = { ...obj("w", 0, 0), points: [{ x: 1, y: 0 }], rotation: 0 }
    const t = transformEntity(wall, { x: 0, y: 0 }, 0, 3)
    expect(t.points).toEqual([{ x: 3, y: 0 }])
    expect(t.rotation).toBe(0)
    const brush: MapEntity = {
      ...obj("s", 0, 0),
      strokes: [{ points: [{ x: 1, y: 1 }], radius: 0.5 }],
    }
    expect(transformEntity(brush, { x: 0, y: 0 }, 0, 2).strokes?.[0]).toEqual({
      points: [{ x: 2, y: 2 }],
      radius: 1,
    })
  })

  it("normalizes angles", () => {
    expect(normalizeDegrees(190)).toBe(-170)
    expect(normalizeDegrees(-180)).toBe(180)
    expect(normalizeDegrees(45)).toBe(45)
  })
})

describe("selectability", () => {
  it("excludes brush paint (strokes and terrain fill)", () => {
    expect(isSelectable({ ...obj("f", 0, 0), strokes: [] })).toBe(false)
    expect(
      isSelectable({ ...obj("s", 0, 0), strokes: [{ points: [{ x: 0, y: 0 }], radius: 1 }] }),
    ).toBe(false)
    expect(
      isSelectable({ ...obj("s", 0, 0), strokes: [{ points: [{ x: 0, y: 0 }], radius: 1 }] }, true),
    ).toBe(true)
    expect(isSelectable({ ...obj("f", 0, 0), strokes: [] }, true)).toBe(false)
    expect(isSelectable(obj("o", 0, 0))).toBe(true)
  })
})

describe("lights", () => {
  const light: MapEntity = { ...obj("l", 5, 5), toolId: "light", params: { range: 3 } }

  it("frame their reach but are picked only near the center", () => {
    expect(entityBounds(light, noSize)).toEqual({ x: 2, y: 2, w: 6, h: 6 })
    expect(entityHit(light, { x: 5.2, y: 5 }, noSize)).toBe(true)
    expect(entityHit(light, { x: 7, y: 5 }, noSize)).toBe(false)
  })

  it("scale by changing their range", () => {
    const grown = scaleEntity(light, { x: 2, y: 2 }, 2, 2)
    expect(grown.params.range).toBe(6)
    expect(grown.position).toEqual({ x: 8, y: 8 })
    expect(grown.scale).toBeUndefined()
    expect(transformEntity(light, { x: 5, y: 5 }, 30, 1).rotation).toBe(30)
  })
})

describe("flipping", () => {
  it("mirrors sprites in place: position reflected, flip toggled, rotation reversed", () => {
    const chair = { ...obj("c", 3, 1), rotation: 30 }
    const f = flipEntity(chair, { x: 2, y: 0 }, "x")
    expect(f.position).toEqual({ x: 1, y: 1 })
    expect(f.flipX).toBe(true)
    expect(f.rotation).toBe(-30)
    expect(flipEntity(f, { x: 2, y: 0 }, "x")).toMatchObject({
      position: { x: 3, y: 1 },
      flipX: false,
      rotation: 30,
    })
    expect(flipEntity(chair, { x: 0, y: 2 }, "y")).toMatchObject({
      position: { x: 3, y: 3 },
      flipY: true,
    })
  })

  it("turns a shape's origin and rotation with it (its texture follows)", () => {
    const floor: MapEntity = {
      ...obj("f", 2, 0),
      toolId: "build",
      points: [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 2 },
      ],
      closed: true,
      rotation: 10,
    }
    const t = transformEntity(floor, { x: 0, y: 0 }, 90, 1)
    expect(t.rotation).toBe(100)
    // Clockwise on screen is counter-clockwise in (mirrored) map space.
    expect(t.position.x).toBeCloseTo(0)
    expect(t.position.y).toBeCloseTo(-2)
    expect(t.points?.[0].x).toBeCloseTo(t.position.x)
    expect(t.points?.[0].y).toBeCloseTo(t.position.y)
    expect(flipEntity(floor, { x: 0, y: 0 }, "y").rotation).toBe(-10)
  })

  it("reflects polyline points without flipping them", () => {
    const wall: MapEntity = {
      ...obj("w", 0, 0),
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 1 },
      ],
    }
    const f = flipEntity(wall, { x: 2, y: 0 }, "x")
    expect(f.points).toEqual([
      { x: 4, y: 0 },
      { x: 0, y: 1 },
    ])
    expect(f.flipX).toBeUndefined()
  })
})

describe("arcs and joins", () => {
  it("tangentArc continues the previous segment on a circle through the end", () => {
    // Heading +x at (0,0), ending at (1,1): a quarter circle around (0,1).
    const pts = tangentArc({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 4)
    expect(pts).toHaveLength(4)
    expect(pts.at(-1)).toEqual({ x: 1, y: 1 })
    for (const p of pts) expect(Math.hypot(p.x, p.y - 1)).toBeCloseTo(1)
    // Leaves along +x: the first point is ahead of the start.
    expect(pts[0].x).toBeGreaterThan(0)
    // No direction to follow, or straight ahead: a plain segment.
    expect(tangentArc(undefined, { x: 0, y: 0 }, { x: 1, y: 1 }, 4)).toEqual([{ x: 1, y: 1 }])
    expect(tangentArc({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }, 4)).toEqual([{ x: 3, y: 0 }])
  })

  it("joinPolylines meets at any pair of ends", () => {
    const a = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]
    const b = [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]
    expect(joinPolylines(a, b)).toEqual([...a, { x: 1, y: 1 }])
    expect(joinPolylines(a, [...b].reverse())).toEqual([...a, { x: 1, y: 1 }])
    expect(joinPolylines(b, a)).toEqual([...a, { x: 1, y: 1 }])
    expect(
      joinPolylines(a, [
        { x: 5, y: 5 },
        { x: 6, y: 6 },
      ]),
    ).toBeNull()
  })
})

describe("spriteUV", () => {
  const sprite = (patch: Partial<MapEntity> = {}): MapEntity => ({
    id: "s",
    toolId: "object",
    layer: 100,
    position: { x: 5, y: 5 },
    rotation: 0,
    params: { asset: "p|a.png" },
    ...patch,
  })
  const size = { w: 2, h: 1 }
  const near = (a: Vec2, b: Vec2) => {
    expect(a.x).toBeCloseTo(b.x)
    expect(a.y).toBeCloseTo(b.y)
  }

  it("maps the center to the texture's middle and map x mirrored", () => {
    near(spriteUV(sprite(), { x: 5, y: 5 }, size), { x: 0.5, y: 0.5 })
    // Map x is mirrored: lower map x is the texture's right side.
    near(spriteUV(sprite(), { x: 4.5, y: 5.25 }, size), { x: 0.75, y: 0.75 })
  })

  it("follows scale, flips and rotation", () => {
    near(spriteUV(sprite({ scale: 2 }), { x: 4, y: 5 }, size), { x: 0.75, y: 0.5 })
    near(spriteUV(sprite({ flipX: true }), { x: 4.5, y: 5 }, size), { x: 0.25, y: 0.5 })
    near(spriteUV(sprite({ flipY: true }), { x: 5, y: 5.25 }, size), { x: 0.5, y: 0.25 })
    // Turned 90°, the texture's right side lies along map +y.
    near(spriteUV(sprite({ rotation: 90 }), { x: 5, y: 5.5 }, size), { x: 0.75, y: 0.5 })
  })

  it("agrees with the footprint's corners", () => {
    const e = sprite({ rotation: 30, scale: 1.5 })
    for (const c of spriteCorners(e, () => size)) {
      const uv = spriteUV(e, c, size)
      expect(Math.min(Math.abs(uv.x), Math.abs(uv.x - 1))).toBeCloseTo(0)
      expect(Math.min(Math.abs(uv.y), Math.abs(uv.y - 1))).toBeCloseTo(0)
    }
  })
})

describe("hitTest with a solid test", () => {
  const at = (id: string, layer: number): MapEntity => ({
    id,
    toolId: "object",
    layer,
    position: { x: 0, y: 0 },
    rotation: 0,
    params: { asset: `p|${id}.png` },
  })
  const sizeOf = () => ({ w: 1, h: 1 })

  it("goes through to what's under where the top one isn't solid", () => {
    const items = [at("under", 100), at("top", 200)]
    expect(hitTest(items, { x: 0, y: 0 }, sizeOf)?.id).toBe("top")
    expect(hitTest(items, { x: 0, y: 0 }, sizeOf, undefined, 0, (e) => e.id !== "top")?.id).toBe(
      "under",
    )
    expect(hitTest(items, { x: 0, y: 0 }, sizeOf, undefined, 0, () => false)).toBeUndefined()
  })
})

describe("square-ended lines (paths, manual roofs)", () => {
  const roof: MapEntity = {
    id: "r",
    toolId: "roof",
    layer: 700,
    position: { x: 0, y: 0 },
    rotation: 0,
    points: [
      { x: 5, y: 5 },
      { x: 5, y: 14 },
    ],
    params: { width: 4 },
  }
  const sizeOf = () => undefined

  it("boxes a roof by its slopes, not a width past each end", () => {
    expect(entityBounds(roof, sizeOf)).toEqual({ x: 1, y: 5, w: 8, h: 9 })
  })

  it("picks it on its slopes but not past the ridge's ends", () => {
    expect(entityHit(roof, { x: 8.5, y: 13.5 }, sizeOf, 0)).toBe(true)
    expect(entityHit(roof, { x: 5, y: 3 }, sizeOf, 0)).toBe(false)
    expect(entityHit(roof, { x: 5, y: 16 }, sizeOf, 0)).toBe(false)
  })

  it("covers the bend of a multi-segment line", () => {
    const bent = { ...roof, points: [...roof.points!, { x: 14, y: 14 }] }
    // Outside both segments' rectangles, at the outer corner of the bend.
    expect(entityHit(bent, { x: 3, y: 16 }, sizeOf, 0)).toBe(true)
    expect(entityHit(bent, { x: 16, y: 14 }, sizeOf, 0)).toBe(false)
  })
})

describe("bandTouchesSolid", () => {
  const bounds = { x: 0, y: 0, w: 2, h: 2 }
  // Solid only in the right half.
  const solid = (p: { x: number; y: number }) => p.x > 1

  it("finds a solid point under the band", () => {
    expect(bandTouchesSolid({ x: 0.5, y: 0.5, w: 1, h: 1 }, bounds, solid)).toBe(true)
    expect(bandTouchesSolid({ x: 0.1, y: 0.1, w: 0.8, h: 1.8 }, bounds, solid)).toBe(false)
  })

  it("samples a click's one point, and nothing off the bounds", () => {
    expect(bandTouchesSolid({ x: 0.5, y: 1, w: 0, h: 0 }, bounds, solid)).toBe(false)
    expect(bandTouchesSolid({ x: 1.5, y: 1, w: 0, h: 0 }, bounds, solid)).toBe(true)
    expect(bandTouchesSolid({ x: 3, y: 3, w: 1, h: 1 }, bounds, () => true)).toBe(false)
  })
})
