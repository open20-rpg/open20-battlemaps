import { describe, expect, it } from "vitest"
import { type MapEntity } from "../map/model/types"
import { ENTITY_PROPERTIES, propertyPatches, sharedProperties } from "./properties"

const entity = (id: string, toolId: string, extra: Partial<MapEntity> = {}): MapEntity => ({
  id,
  toolId,
  layer: 100,
  position: { x: 0, y: 0 },
  rotation: 0,
  params: {},
  ...extra,
})
const keys = (es: MapEntity[]) => sharedProperties(es).map((p) => p.spec.paramKey)

describe("entity properties", () => {
  it("lists a single entity's properties in order", () => {
    expect(keys([entity("a", "object")])).toEqual(
      ENTITY_PROPERTIES.object.map((p) => p.spec.paramKey),
    )
    expect(keys([entity("a", "wall")])).toEqual(["shadow"])
    expect(keys([entity("a", "terrainBrush")])).toEqual([])
  })

  it("keeps only the properties every selected entity has", () => {
    expect(keys([entity("a", "object"), entity("b", "portal")])).toEqual([
      "rotation",
      "scale",
      "flipX",
      "flipY",
      "shadow",
      "blockLight",
    ])
    expect(keys([entity("a", "object"), entity("b", "light")])).toEqual(["rotation", "shadow"])
  })

  it("reads fields and params with defaults", () => {
    const e = entity("a", "object", { rotation: 270, scale: 2, flipY: true })
    const read = (k: string) => ENTITY_PROPERTIES.object.find((p) => p.spec.paramKey === k)?.read(e)
    expect(read("rotation")).toBe(-90)
    expect(read("scale")).toBe(2)
    expect(read("flipY")).toBe(true)
    expect(read("flipX")).toBe(false)
    expect(read("shadow")).toBe(true)
  })

  it("patches fields and params of every entity", () => {
    const a = entity("a", "object", { params: { asset: "x" } })
    const b = entity("b", "scatter")
    expect(propertyPatches([a, b], "shadow", false)).toEqual(
      new Map([
        ["a", { params: { asset: "x", shadow: false } }],
        ["b", { params: { shadow: false } }],
      ]),
    )
    expect(propertyPatches([a], "flipX", false).get("a")).toEqual({ flipX: undefined })
    expect(propertyPatches([a], "layer", 300).get("a")).toEqual({ layer: 300 })
    expect(propertyPatches([a], "range", 3).size).toBe(0)
  })
})
