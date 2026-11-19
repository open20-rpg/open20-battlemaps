import { describe, expect, it } from "vitest"
import {
  canvasKey,
  canvasResolution,
  defaultPreset,
  PRESET_SETTINGS,
  presetOf,
  suggestPreset,
  type RenderPerformance,
  withPerformanceDefaults,
} from "./renderPerformance"

const high = PRESET_SETTINGS.high

describe("render performance", () => {
  it("caps the canvas resolution at the screen's", () => {
    expect(canvasResolution(3, high)).toBe(2)
    expect(canvasResolution(1, high)).toBe(1)
    expect(canvasResolution(0, { maxResolution: 0.5 })).toBe(0.5)
  })

  it("changes the canvas key only for settings that need a new canvas", () => {
    const base = canvasKey(high)
    expect(canvasKey({ ...high, shadowBlurQuality: 0 })).toBe(base)
    expect(canvasKey({ ...high, maxResolution: 1 })).toBe(base)
    expect(canvasKey({ ...high, antialias: !high.antialias })).not.toBe(base)
    expect(canvasKey({ ...high, textureScale: 0.5 })).not.toBe(base)
    expect(canvasKey({ ...high, waterEffect: false })).not.toBe(base)
  })

  it("fills settings saved before one existed with its default", () => {
    expect(withPerformanceDefaults({ antialias: false }, high)).toEqual({
      ...high,
      antialias: false,
    })
    expect(withPerformanceDefaults(undefined, high)).toEqual(high)
  })

  it("completes a saved preset with that preset's newer settings, dropping retired ones", () => {
    const savedUltra: Partial<RenderPerformance> = { ...PRESET_SETTINGS.ultra }
    delete savedUltra.mipmaps
    // A text quality saved in pixels (v0.3.48) and a setting that's gone.
    const old = { ...savedUltra, textQuality: 160, gone: 1 } as Partial<RenderPerformance>
    expect(withPerformanceDefaults(old, PRESET_SETTINGS.low)).toEqual(PRESET_SETTINGS.ultra)
  })

  it("rasterizes text at the assets' density in Ultra, fractions of it below", () => {
    expect(
      ["low", "medium", "high", "ultra"].map((p) => PRESET_SETTINGS[p as "low"].textQuality),
    ).toEqual([0.25, 0.5, 0.75, 1])
  })
})

describe("graphics presets", () => {
  it("starts phones and tablets on Low, the rest on Medium", () => {
    expect(defaultPreset(true)).toBe("low")
    expect(defaultPreset(false)).toBe("medium")
  })

  it("tells which preset the settings are, or none once tuned by hand", () => {
    expect(presetOf(PRESET_SETTINGS.ultra)).toBe("ultra")
    expect(presetOf({ ...PRESET_SETTINGS.low })).toBe("low")
    expect(presetOf({ ...PRESET_SETTINGS.medium, waterEffect: false })).toBeNull()
  })

  it("suggests the preset closest to 60 fps, the richer on a tie", () => {
    expect(
      suggestPreset([
        { preset: "low", fps: 200 },
        { preset: "medium", fps: 95 },
        { preset: "high", fps: 58 },
        { preset: "ultra", fps: 22 },
      ]),
    ).toBe("high")
    // Even the lightest is slow: the fastest one.
    expect(suggestPreset([{ preset: "low", fps: 12 }])).toBe("low")
    expect(
      suggestPreset([
        { preset: "medium", fps: 50 },
        { preset: "high", fps: 70 },
      ]),
    ).toBe("high")
    expect(suggestPreset([])).toBeNull()
  })
})

describe("preset balance", () => {
  const order = ["low", "medium", "high", "ultra"] as const
  it("only Ultra antialiases; every preset keeps 32-bit shaders and the water effect", () => {
    for (const p of order) {
      expect(PRESET_SETTINGS[p].antialias).toBe(p === "ultra")
      expect(PRESET_SETTINGS[p].highPrecision).toBe(true)
      expect(PRESET_SETTINGS[p].waterEffect).toBe(true)
    }
  })

  it("Low: 1×, textures and painted layers at 50%, one blur pass", () => {
    expect(PRESET_SETTINGS.low).toMatchObject({
      maxResolution: 1,
      textureScale: 0.5,
      terrainResolution: 0.5,
      maskDetail: 0.5,
      shadowBlurQuality: 1,
      lightBlurQuality: 1,
    })
  })

  it("never lowers a setting going up", () => {
    const keys = [
      "maxResolution",
      "textureScale",
      "terrainResolution",
      "maskDetail",
      "shadowBlurQuality",
      "lightBlurQuality",
      "textQuality",
    ] as const
    for (let i = 1; i < order.length; i++) {
      for (const k of keys) {
        expect(PRESET_SETTINGS[order[i]][k]).toBeGreaterThanOrEqual(
          PRESET_SETTINGS[order[i - 1]][k],
        )
      }
    }
  })
})
