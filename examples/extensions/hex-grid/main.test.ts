import { afterEach, describe, expect, it } from "vitest"
import { useMapStore } from "../../../src/stores/mapStore"
import { useEditorStore } from "../../../src/stores/editorStore"
import { useExtensionsStore } from "../../../src/stores/extensionsStore"
import { useViewStore } from "../../../src/stores/viewStore"
import { contribution, startExample } from "../testing"
import manifest from "./manifest.json"
import hex, { fromAxial, hexDistance, hexLines, toAxial } from "./src/main"

let stop: (() => void) | undefined
afterEach(() => stop?.())

describe("hex grid", () => {
  it("rounds points to hexes and back", () => {
    for (const [q, r] of [
      [0, 0],
      [3, -1],
      [-2, 4],
    ])
      expect(toAxial(fromAxial(q, r))).toEqual({ q, r })
    expect(hexDistance(fromAxial(0, 0), fromAxial(3, 0))).toBe(3)
    expect(hexLines(4, 4).length).toBeGreaterThan(10)
  })

  it("draws, snaps and labels as a grid kind, and switches the map to it", async () => {
    const { h } = await startExample(hex, manifest)
    stop = () => h.stop()
    const g = contribution("gridType", "hex")
    expect((await g.draw({ x: 0, y: 0, w: 5, h: 5 })).length).toBeGreaterThan(5)
    expect(await g.snap({ x: 0.05, y: 0.02 })).toEqual(fromAxial(0, 0))
    expect(await g.label!(fromAxial(1, 2))).toBe("0102")
    await contribution("command", "use-hex").run()
    expect(useMapStore.getState().map!.grid).toEqual({
      kind: "ext:open20.hex-grid/hex",
      unit: "km",
      cellDistance: 10,
    })
    expect(useViewStore.getState().grid).toBe(true)
  })

  it("offers wall corners to snap to", async () => {
    const { h, ctx } = await startExample(hex, manifest)
    stop = () => h.stop()
    await ctx.map.add([
      {
        kind: "wall",
        position: { x: 2, y: 2 },
        points: [
          { x: 2, y: 2 },
          { x: 4, y: 2 },
        ],
      },
    ])
    expect(
      await contribution("snapProvider", "wall-corners").points({ x: 2.1, y: 2 }, 0.5),
    ).toContainEqual({ x: 2, y: 2 })
  })

  it("shows coordinates as an overlay, the hovered hex in the status bar, and a layer", async () => {
    const { h } = await startExample(hex, manifest)
    stop = () => h.stop()
    await contribution("viewToggle", "coords").onChange(true)
    expect(
      useExtensionsStore.getState().overlays["open20.hex-grid::coords"].primitives.length,
    ).toBeGreaterThan(3)
    await contribution("viewToggle", "coords").onChange(false)
    expect(useExtensionsStore.getState().overlays["open20.hex-grid::coords"]).toBeUndefined()
    useEditorStore.getState().setPointer(fromAxial(2, 1))
    await h.flush()
    expect(useExtensionsStore.getState().statusItems["open20.hex-grid::hex"]?.text).toBe("Hex 2,1")
    expect(contribution("layer", "hex-marks")).toMatchObject({ value: 650 })
  })
})
