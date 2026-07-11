import { describe, expect, it } from "vitest"
import { TOOL_TREE, findToolPath, shapeVsEditPoints } from "./tools"

describe("findToolPath", () => {
  it("finds a top-level leaf as a single-node path", () => {
    const path = findToolPath(TOOL_TREE, "select")
    expect(path?.map((n) => n.id)).toEqual(["select"])
  })

  it("finds a nested tool including its group chain", () => {
    const path = findToolPath(TOOL_TREE, "wall")
    expect(path?.map((n) => n.id)).toEqual(["design", "wall"])
    expect(path?.at(-1)?.type).toBe("tool")
  })

  it("returns null for unknown ids", () => {
    expect(findToolPath(TOOL_TREE, "nope")).toBeNull()
  })
})

describe("shapeVsEditPoints", () => {
  const normalize = shapeVsEditPoints("rectangle")

  it("clears the shape when edit-points turns on", () => {
    const out = normalize({ shape: "ellipse", editPoints: true }, { editPoints: true })
    expect(out).toEqual({ shape: null, editPoints: true })
  })

  it("turns edit-points off when a shape is picked", () => {
    const out = normalize({ shape: "path", editPoints: true }, { shape: "path" })
    expect(out).toEqual({ shape: "path", editPoints: false })
  })

  it("restores the default shape when edit-points turns off with no shape", () => {
    const out = normalize({ shape: null, editPoints: false }, { editPoints: false })
    expect(out).toEqual({ shape: "rectangle", editPoints: false })
  })

  it("leaves unrelated patches untouched", () => {
    const merged = { shape: "ellipse", editPoints: false, other: 1 }
    expect(normalize(merged, { other: 1 })).toBe(merged)
  })
})
