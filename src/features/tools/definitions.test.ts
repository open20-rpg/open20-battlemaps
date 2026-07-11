import { describe, expect, it } from "vitest"
import { TOOL_BY_ID, TOOL_TREE, findToolPath } from "./definitions"

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

describe("TOOL_BY_ID", () => {
  it("indexes every leaf exactly once", () => {
    const count = (nodes: typeof TOOL_TREE): number =>
      nodes.reduce((n, node) => n + (node.type === "tool" ? 1 : count(node.children)), 0)
    expect(TOOL_BY_ID.size).toBe(count(TOOL_TREE))
    expect(TOOL_BY_ID.get("wall")?.type).toBe("tool")
  })
})
