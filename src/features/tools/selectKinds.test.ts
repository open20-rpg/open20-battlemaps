import { describe, expect, it } from "vitest"
import { type MapEntity } from "../map/model/types"
import { SELECT_FILTER_DEFAULT, SELECT_KINDS, idsOfKind, selectableBy } from "./selectKinds"

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

  it("filters what Select can pick by kind; paint only when its kind is on", () => {
    const pick = selectableBy(SELECT_FILTER_DEFAULT)
    expect(pick(e("o", "object"))).toBe(true)
    expect(pick(e("l", "light"))).toBe(false)
    const stroke = { points: [{ x: 0, y: 0 }], radius: 1 }
    expect(pick(e("c", "cave", { strokes: [stroke] }))).toBe(true)
    expect(selectableBy([])(e("c", "cave", { strokes: [stroke] }))).toBe(false)
    // The terrain (a blend map, no shapes) is never pickable.
    expect(pick(e("t", "terrainBrush", { strokes: [] }))).toBe(false)
    // Kinds not listed are always pickable.
    expect(selectableBy([])(e("x", "somethingElse"))).toBe(true)
  })

  it("picks a floor left without its wall even with floors filtered out", () => {
    const pick = (all: MapEntity[]) => selectableBy(SELECT_FILTER_DEFAULT, false, all)
    const floor = e("f", "build", { link: "L", points: [{ x: 0, y: 0 }], closed: true })
    const wall = e("w", "wall", { link: "L", points: [{ x: 0, y: 0 }], closed: true })
    expect(pick([floor, wall])(floor)).toBe(false)
    expect(pick([floor])(floor)).toBe(true)
    // An unlinked floor (e.g. from an old map) has no wall standing for it either.
    expect(pick([])(e("g", "build", { points: [{ x: 0, y: 0 }], closed: true }))).toBe(true)
  })
})
