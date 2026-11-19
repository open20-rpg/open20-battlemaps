import { describe, expect, it } from "vitest"
import {
  canvasKey,
  canvasResolution,
  defaultPreset,
  PRESET_SETTINGS,
  presetOf,
  suggestPreset,
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
    expect(canvasKey({ ...high, antialias: false })).not.toBe(base)
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
