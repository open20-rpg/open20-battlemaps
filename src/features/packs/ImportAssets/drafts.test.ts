import { describe, expect, it } from "vitest"
import { draftsFor, toImportItem, withCategory } from "./drafts"

describe("import drafts", () => {
  it("starts objects trimmed and pairs wall parts", () => {
    const [chair] = draftsFor(["/a/chair.png"], "objects")
    expect(chair.adjust.trim).toBe(true)
    const walls = draftsFor(["/w/stone.png", "/w/stone_end.png"], "walls")
    expect(walls).toHaveLength(1)
    expect(walls[0].adjust.trim).toBe(false)
    expect(walls[0].parts).toEqual({ end: "/w/stone_end.png" })
  })

  it("skips files already listed (as items or parts)", () => {
    const first = draftsFor(["/w/stone.png", "/w/stone_end.png"], "walls")
    expect(
      draftsFor(["/w/stone_end.png", "/w/brick.png"], "walls", first).map((d) => d.name),
    ).toEqual(["Brick"])
  })

  it("drops parts and options the new category lacks", () => {
    const [wall] = draftsFor(["/w/stone.png", "/w/stone_end.png"], "walls")
    const { draft, loose } = withCategory({ ...wall, color: "#ff0000" }, "objects")
    expect(draft.parts).toEqual({})
    expect(loose).toEqual(["/w/stone_end.png"])
    expect(draft.color).toBeNull()
    expect(draft.adjust.trim).toBe(true)
  })

  it("sends only what the category supports", () => {
    const [d] = draftsFor(["/l/glow.png"], "lights")
    const item = toImportItem({ ...d, colorable: true, folder: "x", color: "#fff", name: "  " })
    expect(item).toMatchObject({ colorable: false, folder: "", color: null, name: "Asset" })
  })
})
