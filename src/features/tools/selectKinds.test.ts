import { describe, expect, it } from "vitest"
import { type MapEntity } from "../map/model/types"
import { SELECT_KINDS, idsOfKind } from "./selectKinds"

const e = (id: string, toolId: string, extra: Partial<MapEntity> = {}): MapEntity => ({
  id,
  toolId,
  layer: 100,
  position: { x: 0, y: 0 },
  rotation: 0,
  params: {},
  ...extra,
})
const kind = (id: string) => SELECT_KINDS.find((k) => k.id === id)!

describe("select by kind", () => {
  const all = [
    e("o1", "object"),
    e("s1", "scatter", { group: "g" }),
    e("w1", "wall", {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      group: "g",
    }),
    e("w2", "wall", {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    }),
    // Brush paint isn't selectable.
    e("wb", "water", { strokes: [] }),
  ]

  it("picks every entity of the kind's tools, with their whole groups", () => {
    expect(idsOfKind(kind("objects"), all).sort()).toEqual(["o1", "s1", "w1"])
    expect(idsOfKind(kind("walls"), all).sort()).toEqual(["s1", "w1", "w2"])
  })

  it("skips what can't be selected and kinds with nothing on the map", () => {
    expect(idsOfKind(kind("water"), all)).toEqual([])
    expect(idsOfKind(kind("lights"), all)).toEqual([])
  })

  it("declares each kind once", () => {
    expect(new Set(SELECT_KINDS.map((k) => k.id)).size).toBe(SELECT_KINDS.length)
  })
})
