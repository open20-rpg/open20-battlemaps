import { describe, expect, it } from "vitest"
import { type MapEntity } from "../map/model/types"
import { DEFAULT_FONT, type CatalogFamily } from "./catalog"
import { resolveFontNames } from "./resolve"

const catalog: CatalogFamily[] = [
  { f: "Bangers", d: "ofl/bangers", files: ["Bangers-Regular.ttf"], s: [[400, 0, 0]] },
  { f: "Lora", d: "ofl/lora", files: ["Lora[wght].ttf"], s: [[700, 0, 0]] },
]
const text = (font: unknown): MapEntity => ({
  id: String(font),
  toolId: "text",
  layer: 900,
  position: { x: 0, y: 0 },
  rotation: 0,
  params: { font },
})

describe("resolveFontNames", () => {
  it("turns imported font names into fonts, counting unknown ones", () => {
    const { entities, unknown } = resolveFontNames(
      [text("Lora Bold"), text("Bangers"), text("Papyrus"), text("")],
      catalog,
    )
    expect(entities.map((e) => e.params.font)).toEqual([
      { family: "Lora", weight: 700, italic: false },
      { family: "Bangers", weight: 400, italic: false },
      DEFAULT_FONT,
      DEFAULT_FONT,
    ])
    expect(unknown).toBe(1)
  })

  it("leaves other entities and already resolved fonts alone", () => {
    const resolved = text({ family: "Lora", weight: 700, italic: false })
    const wall = { ...text("x"), toolId: "wall" }
    const { entities } = resolveFontNames([resolved, wall], catalog)
    expect(entities[0]).toBe(resolved)
    expect(entities[1]).toBe(wall)
  })
})
