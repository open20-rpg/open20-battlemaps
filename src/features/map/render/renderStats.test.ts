import { describe, expect, it } from "vitest"
import { Container } from "pixi.js"
import { countNodes, frameStats } from "./renderStats"

describe("render stats", () => {
  it("averages the frames of the last second", () => {
    const frames = [
      { at: 100, ms: 50, drawCalls: 9 },
      { at: 1500, ms: 4, drawCalls: 3 },
      { at: 1900, ms: 8, drawCalls: 5 },
    ]
    expect(frameStats(frames, 2000)).toEqual({ fps: 2, avgMs: 6, maxMs: 8, drawCalls: 5 })
  })

  it("reads zero with nothing drawn", () => {
    expect(frameStats([], 5000)).toEqual({ fps: 0, avgMs: 0, maxMs: 0, drawCalls: 0 })
  })

  it("counts every display object in the tree", () => {
    const root = new Container()
    const child = new Container()
    child.addChild(new Container(), new Container())
    root.addChild(child, new Container())
    expect(countNodes(root)).toBe(5)
  })
})
