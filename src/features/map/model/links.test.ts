import { describe, expect, it } from "vitest"
import { regroup } from "./groups"
import { insertVertexPatches, linkRooms, vertexPatches, withLinked } from "./links"
import { type MapEntity } from "./types"

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
]
const e = (id: string, toolId: string, extra: Partial<MapEntity> = {}): MapEntity => ({
  id,
  toolId,
  layer: 0,
  position: { x: 0, y: 0 },
  rotation: 0,
  params: {},
  ...extra,
})
const floor = e("f", "build", { points: square, closed: true, link: "L" })
// The wall starts at another vertex: partners match vertices by place.
const wall = e("w", "wall", { points: [...square.slice(1), square[0]], closed: true, link: "L" })
const all = [floor, wall, e("o", "object")]

describe("linked floor and wall", () => {
  it("pulls the partners into an operation", () => {
    expect(withLinked(["f"], all).sort()).toEqual(["f", "w"])
    expect(withLinked(["o"], all)).toEqual(["o"])
  })

  it("moves and removes the same vertex in both", () => {
    const moved = vertexPatches(floor, 1, { x: 5, y: 0 }, all)
    expect(moved.get("f")?.points?.[1]).toEqual({ x: 5, y: 0 })
    expect(moved.get("w")?.points?.[0]).toEqual({ x: 5, y: 0 })
    const removed = vertexPatches(floor, 1, null, all)
    expect(removed.get("w")?.points).toHaveLength(3)
    expect(removed.get("w")?.points?.some((p) => p.x === 4 && p.y === 0)).toBe(false)
  })

  it("copies get a link of their own", () => {
    const [f2, w2] = regroup([floor, wall])
    expect(f2.link).toBe(w2.link)
    expect(f2.link).not.toBe("L")
  })
})

describe("linking imported rooms", () => {
  it("links a floor to the closed wall tracing its outline on its level", () => {
    const loose = [
      e("f", "build", { points: square, closed: true, level: "a" }),
      e("w", "wall", { points: [...square].reverse(), closed: true, level: "a" }),
      e("w2", "wall", { points: square, closed: true, level: "b" }),
    ]
    const [f, w, w2] = linkRooms(loose)
    expect(f.link).toBeDefined()
    expect(w.link).toBe(f.link)
    expect(w2.link).toBeUndefined()
  })
})

describe("inserting vertices", () => {
  it("adds the point on the segment, in linked entities too", () => {
    const patches = insertVertexPatches(floor, 0, { x: 2, y: 0 }, all)
    expect(patches.get("f")?.points?.[1]).toEqual({ x: 2, y: 0 })
    // The wall runs (4,0)…(0,0): its closing segment joins the same points.
    const w = patches.get("w")?.points ?? []
    expect(w).toHaveLength(5)
    expect(w.at(-1)).toEqual({ x: 2, y: 0 })
  })
})
