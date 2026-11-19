import { describe, expect, it } from "vitest"
import { DEFAULT_FONT } from "../fonts/catalog"
import { migrateMap } from "./migrate"
import { type MapDocument, type MapEntity } from "./model/types"

const label: MapEntity = {
  id: "t",
  toolId: "text",
  layer: 900,
  position: { x: 10, y: 10 },
  rotation: 0,
  text: "ab\ncd",
  params: { font: "Georgia", fontSize: 64, sharpenFonts: true, textBox: true },
}
const map = { entities: [label] } as unknown as MapDocument

describe("migrateMap", () => {
  it("anchors version 1 labels at their top-left corner, on one line", () => {
    const { map: out } = migrateMap(1, map, {})
    const [t] = out.entities
    // 2 letters × 0.6 em wide, 2 lines × 1.2 em tall, at 1 em = 1 tile.
    expect(t.position.x).toBeCloseTo(10.6)
    expect(t.position.y).toBeCloseTo(8.8)
    expect(t.text).toBe("ab cd")
    expect(t.params).toEqual({
      font: { ...DEFAULT_FONT, family: "Georgia" },
      fontSize: 64,
      boxShape: "rectangle",
    })
  })

  it("updates the Text tool's saved params", () => {
    const { tools } = migrateMap(1, map, { text: { font: "", textBox: false }, wall: { x: 1 } })
    expect(tools.text).toEqual({ font: DEFAULT_FONT, boxShape: "none" })
    expect(tools.wall).toEqual({ x: 1 })
  })

  it("leaves current maps alone", () => {
    expect(migrateMap(3, map, {}).map).toBe(map)
  })

  it("lays version 2 floors' and patterns' textures from the map's origin, as they were", () => {
    const shape = (toolId: string): MapEntity => ({
      id: toolId,
      toolId,
      layer: 0,
      position: { x: 3, y: 4 },
      rotation: 0,
      points: [
        { x: 3, y: 4 },
        { x: 5, y: 4 },
        { x: 5, y: 6 },
      ],
      closed: true,
      params: {},
    })
    const doc = {
      entities: [shape("build"), shape("pattern"), shape("wall")],
    } as unknown as MapDocument
    const [floor, pattern, wall] = migrateMap(2, doc, {}).map.entities
    expect(floor.position).toEqual({ x: 0, y: 0 })
    expect(pattern.position).toEqual({ x: 0, y: 0 })
    expect(pattern.points).toEqual(shape("pattern").points)
    expect(wall.position).toEqual({ x: 3, y: 4 })
  })
})
