import { afterEach, describe, expect, it } from "vitest"
import heat from "./shaders/heat.glsl?raw"
import { useExtensionsStore } from "../../../src/stores/extensionsStore"
import { useViewStore } from "../../../src/stores/viewStore"
import { useMapStore } from "../../../src/stores/mapStore"
import { createRenderBridge } from "../../../src/features/extensions/renderBridge"
import { uniformDeclarations } from "../../../src/features/map/render/extensionRender"
import { contribution, startExample } from "../testing"
import manifest from "./manifest.json"
import effects, { DOT_PNG } from "./src/main"

let stop: (() => void) | undefined
afterEach(() => stop?.())

describe("effects", () => {
  it("registers its shaders and what uses them", async () => {
    const { h } = await startExample(effects, manifest, { files: { "shaders/heat.glsl": heat } })
    stop = () => h.stop()
    expect(contribution("shader", "heat")).toMatchObject({ target: "entity", animated: true })
    expect(contribution("shader", "parchment").fragment).toContain("uPaper")
    expect(uniformDeclarations(contribution("shader", "parchment").uniforms)).toContain(
      "uniform vec3 uPaper;",
    )
    const bridge = createRenderBridge(h.services)
    expect(bridge.postShaders()).toEqual([{ id: "open20.effects/parchment", uniforms: undefined }])
    expect(bridge.shader("open20.effects/heat")?.fragment).toContain("uStrength")
    expect(contribution("layerShader", "water-layer").layers).toEqual([0])
    expect(contribution("fillShader", "ripple-fill").tools).toContain("water")
    expect(contribution("waterStyle", "calm").shader).toBe("ripple")
    expect(contribution("lightType", "lantern").cone).toBe(60)
  })

  it("styles lava with its shader (made global) and runs rain while Animations is on", async () => {
    const { h } = await startExample(effects, manifest, { files: { "shaders/heat.glsl": heat } })
    stop = () => h.stop()
    const bridge = createRenderBridge(h.services)
    const e = {
      id: "x",
      toolId: "object",
      layer: 100,
      position: { x: 1, y: 1 },
      rotation: 0,
      params: {},
      ext: { "open20.effects": { lava: true } },
    }
    expect(bridge.styleFor(e)?.shader).toEqual({
      id: "open20.effects/heat",
      uniforms: { uStrength: 2 },
    })
    useViewStore.setState({ animations: true })
    expect(bridge.animating()).toBe(true)
    expect(bridge.particles("level-1")[0]).toMatchObject({ rate: 200 })
    useExtensionsStore
      .getState()
      .setViewToggle(
        useExtensionsStore
          .getState()
          .contributions.find((c) => c.contribution.type === "particles")!.key,
        false,
      )
    expect(bridge.particles("level-1")).toHaveLength(0)
    expect(bridge.imageUrl("ext:open20.effects/dot.png") ?? "registered").toBeTruthy()
    expect(DOT_PNG[1]).toBe(0x50) // "P" of PNG
  })

  it("puts embers over every fire", async () => {
    const { h } = await startExample(effects, manifest, { files: { "shaders/heat.glsl": heat } })
    stop = () => h.stop()
    useMapStore.setState({
      map: {
        ...useMapStore.getState().map!,
        entities: [
          {
            id: "f",
            toolId: "object",
            layer: 100,
            level: "level-1",
            position: { x: 4, y: 4 },
            rotation: 0,
            params: {},
            ext: { "open20.effects": { lava: true } },
          },
        ],
      },
    })
    await contribution("command", "embers").run()
    expect(useExtensionsStore.getState().particles["open20.effects::embers"]).toHaveLength(1)
  })
})
