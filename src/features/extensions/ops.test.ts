import { describe, expect, it } from "vitest"
import { createDocument, type MapDocument, type MapEntity } from "../map/model/types"
import { applyOps, diffEntities, kindOwner, reorder, toSdkEntity } from "./ops"

const ent = (id: string, extra: Partial<MapEntity> = {}): MapEntity => ({
  id,
  toolId: "object",
  layer: 100,
  level: "level-1",
  position: { x: 1, y: 1 },
  rotation: 0,
  params: { asset: "p|a.png", color: "" },
  ...extra,
})

const doc = (entities: MapEntity[]): MapDocument => ({ ...createDocument(10, 10), entities })

describe("toSdkEntity", () => {
  it("shows the stable view with the extension's own data only", () => {
    const e = toSdkEntity(
      ent("a", { ext: { "a.b": { tint: "#f00" }, "c.d": { secret: 1 } }, flipX: true }),
      "a.b",
      "level-1",
    )
    expect(e).toMatchObject({
      id: "a",
      kind: "object",
      asset: "p|a.png",
      flipX: true,
      data: { tint: "#f00" },
    })
    expect(e.data).not.toHaveProperty("secret")
  })
})

describe("applyOps", () => {
  it("adds entities with defaults and returns their ids", () => {
    const r = applyOps(
      doc([]),
      [
        {
          op: "add",
          entities: [
            {
              kind: "wall",
              position: { x: 0, y: 0 },
              points: [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
              ],
            },
          ],
        },
      ],
      "a.b",
      "level-1",
    )
    expect(r.created).toHaveLength(1)
    expect(r.map.entities[0]).toMatchObject({ toolId: "wall", layer: 600, level: "level-1" })
    expect(r.change.added).toEqual(r.created)
  })

  it("only lets an extension create its own entity kinds", () => {
    expect(() =>
      applyOps(
        doc([]),
        [{ op: "add", entities: [{ kind: "ext:other.ext/door", position: { x: 0, y: 0 } }] }],
        "a.b",
        "level-1",
      ),
    ).toThrow(/only other.ext/)
    const ok = applyOps(
      doc([]),
      [
        {
          op: "add",
          entities: [{ kind: "ext:a.b/door", position: { x: 0, y: 0 }, data: { w: 2 } }],
        },
      ],
      "a.b",
      "level-1",
    )
    expect(ok.map.entities[0].ext).toEqual({ "a.b": { w: 2 } })
    expect(kindOwner("ext:a.b/door")).toBe("a.b")
    expect(() =>
      applyOps(
        doc([]),
        [{ op: "add", entities: [{ kind: "bogus" as never, position: { x: 0, y: 0 } }] }],
        "a.b",
        "l",
      ),
    ).toThrow()
  })

  it("leaves locked entities alone and counts them as skipped", () => {
    const r = applyOps(
      doc([ent("a", { locked: true }), ent("b")]),
      [{ op: "move", ids: ["a", "b"], delta: { x: 1, y: 0 } }],
      "x.y",
      "level-1",
    )
    expect(r.map.entities[0].position).toEqual({ x: 1, y: 1 })
    expect(r.map.entities[1].position).toEqual({ x: 2, y: 1 })
    expect(r.skipped).toBe(1)
  })

  it("moves attached entities with their parent and refuses cycles", () => {
    const base = doc([ent("p"), ent("c", { parent: "p" })])
    const r = applyOps(base, [{ op: "move", ids: ["p"], delta: { x: 0, y: 2 } }], "x.y", "level-1")
    expect(r.map.entities[1].position).toEqual({ x: 1, y: 3 })
    expect(() => applyOps(base, [{ op: "attach", ids: ["p"], parent: "c" }], "x.y", "l")).toThrow(
      /own child/,
    )
  })

  it("writes only the extension's own data", () => {
    const base = doc([ent("a", { ext: { "o.t": { keep: true } } })])
    const r = applyOps(
      base,
      [
        { op: "setData", id: "a", data: { mine: 1 } },
        { op: "setMapData", data: { k: 1 } },
      ],
      "a.b",
      "l",
    )
    expect(r.map.entities[0].ext).toEqual({ "o.t": { keep: true }, "a.b": { mine: 1 } })
    expect(r.map.ext).toEqual({ "a.b": { k: 1 } })
    const cleared = applyOps(r.map, [{ op: "setData", id: "a", data: null }], "a.b", "l")
    expect(cleared.map.entities[0].ext).toEqual({ "o.t": { keep: true } })
  })

  it("edits levels, settings and the grid with validation", () => {
    let m = applyOps(
      doc([]),
      [
        { op: "addLevel", name: "Sótano", id: "b" },
        { op: "setLevelData", id: "b", data: { elevation: -1 } },
      ],
      "a.b",
      "l",
    ).map
    expect(m.levels.map((l) => l.id)).toEqual(["level-1", "b"])
    expect(m.levels[1].ext).toEqual({ "a.b": { elevation: -1 } })
    m = applyOps(
      m,
      [
        { op: "setGrid", grid: { kind: "ext:a.b/hex", unit: "m" } },
        { op: "setPostProcess", values: { brightness: 9, bogus: 1 } },
      ],
      "a.b",
      "l",
    ).map
    expect(m.grid).toEqual({ kind: "ext:a.b/hex", cellDistance: 5, unit: "m" })
    expect(m.postProcess.brightness).toBe(1)
    expect(() => applyOps(m, [{ op: "setAmbientLight", color: "red" }], "a.b", "l")).toThrow()
    expect(() => applyOps(m, [{ op: "resize", width: 0, height: 5 }], "a.b", "l")).toThrow()
  })

  it("groups, links, locks and transforms", () => {
    const base = doc([ent("a"), ent("b", { position: { x: 3, y: 1 } })])
    const r = applyOps(
      base,
      [
        { op: "group", ids: ["a", "b"] },
        { op: "link", ids: ["a", "b"] },
        { op: "transform", ids: ["a", "b"], rotate: 90 },
        { op: "lock", ids: ["a"], locked: true },
      ],
      "a.b",
      "l",
    )
    const [a, b] = r.map.entities
    expect(a.group).toBeDefined()
    expect(a.group).toBe(b.group)
    expect(a.link).toBe(b.link)
    expect(a.locked).toBe(true)
    expect(a.rotation).toBe(90)
  })
})

describe("reorder and diff", () => {
  it("moves entities in the draw order", () => {
    const list = ["a", "b", "c", "d"].map((id) => ent(id))
    expect(reorder(list, ["b"], "front").map((e) => e.id)).toEqual(["a", "c", "d", "b"])
    expect(reorder(list, ["c"], "back").map((e) => e.id)).toEqual(["c", "a", "b", "d"])
    expect(reorder(list, ["b"], "forward").map((e) => e.id)).toEqual(["a", "c", "b", "d"])
    expect(reorder(list, ["c"], "backward").map((e) => e.id)).toEqual(["a", "c", "b", "d"])
  })

  it("tells what changed between documents", () => {
    const a = ent("a")
    const before = doc([a, ent("b")])
    const after = { ...before, entities: [a, ent("c")] }
    expect(diffEntities(before, after)).toEqual({
      added: ["c"],
      updated: [],
      removed: ["b"],
      settings: false,
    })
  })
})
