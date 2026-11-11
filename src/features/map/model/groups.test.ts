import { describe, expect, it } from "vitest"
import { expandGroups, regroup } from "./groups"
import { type MapEntity } from "./types"

const e = (id: string, group?: string): MapEntity => ({
  id,
  toolId: "object",
  layer: 100,
  position: { x: 0, y: 0 },
  rotation: 0,
  params: {},
  group,
})

describe("groups", () => {
  const all = [e("a", "g1"), e("b", "g1"), e("c"), e("d", "g2"), e("f", "g2")]

  it("expands a pick to its whole groups", () => {
    expect(expandGroups(["a"], all).sort()).toEqual(["a", "b"])
    expect(expandGroups(["c"], all)).toEqual(["c"])
    expect(expandGroups(["c", "f"], all).sort()).toEqual(["c", "d", "f"])
  })

  it("gives copies fresh groups, kept together", () => {
    const [a, b, c] = regroup([all[0], all[1], all[2]])
    expect(a.group).toBeDefined()
    expect(a.group).not.toBe("g1")
    expect(b.group).toBe(a.group)
    expect(c.group).toBeUndefined()
  })
})
