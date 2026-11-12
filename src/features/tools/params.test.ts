import { describe, expect, it } from "vitest"
import { paramRuns, resolveParams, shapeVsEditPoints, type ToolParamSpec } from "./params"
import { TOOL_BY_ID } from "./definitions"

describe("resolveParams", () => {
  const specs: ToolParamSpec[] = [
    { kind: "switch", paramKey: "shadow", labelKey: "tools.shadow", default: true },
    { kind: "slider", paramKey: "rotation", labelKey: "r", min: 0, max: 10, step: 1, default: 3 },
  ]

  it("materializes every declared default", () => {
    expect(resolveParams(specs)).toEqual({ shadow: true, rotation: 3 })
  })

  it("overlays stored values on top of defaults", () => {
    expect(resolveParams(specs, { rotation: 7 })).toEqual({ shadow: true, rotation: 7 })
  })

  it("keeps stored keys not covered by specs (forward compat)", () => {
    expect(resolveParams(specs, { extra: 1 })).toMatchObject({ extra: 1, shadow: true })
  })

  it("resolves complete bags for every tool in the tree", () => {
    for (const tool of TOOL_BY_ID.values()) {
      const bag = resolveParams(tool.params)
      for (const spec of tool.params ?? []) {
        expect(bag, `tool ${tool.id} param ${spec.paramKey}`).toHaveProperty(spec.paramKey)
      }
    }
  })
})

describe("param specs are well-formed", () => {
  it("no tool declares two params with the same paramKey", () => {
    for (const tool of TOOL_BY_ID.values()) {
      const keys = (tool.params ?? []).map((s) => s.paramKey)
      expect(new Set(keys).size, `tool ${tool.id}`).toBe(keys.length)
    }
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

describe("paramRuns", () => {
  const btn = (k: string): ToolParamSpec => ({
    kind: "button",
    paramKey: k,
    labelKey: k,
    icon: () => null,
    default: null,
  })
  const sw: ToolParamSpec = { kind: "switch", paramKey: "s", labelKey: "s", default: false }

  it("packs runs of at least three buttons together", () => {
    const runs = paramRuns([sw, btn("a"), btn("b"), btn("c"), sw])
    expect(runs.map((r) => r.kind)).toEqual(["single", "buttons", "single"])
    expect(runs[1]).toMatchObject({
      specs: [{ paramKey: "a" }, { paramKey: "b" }, { paramKey: "c" }],
    })
  })

  it("leaves short runs as single params", () => {
    const runs = paramRuns([btn("a"), btn("b"), sw, btn("c")])
    expect(runs.map((r) => r.kind)).toEqual(["single", "single", "single", "single"])
  })
})
