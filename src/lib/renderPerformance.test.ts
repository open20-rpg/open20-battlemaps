import { describe, expect, it } from "vitest"
import {
  canvasKey,
  canvasResolution,
  DEFAULT_RENDER_PERFORMANCE,
  withPerformanceDefaults,
} from "./renderPerformance"

describe("render performance", () => {
  it("caps the canvas resolution at the screen's", () => {
    expect(canvasResolution(3, DEFAULT_RENDER_PERFORMANCE)).toBe(2)
    expect(canvasResolution(1, DEFAULT_RENDER_PERFORMANCE)).toBe(1)
    expect(canvasResolution(0, { ...DEFAULT_RENDER_PERFORMANCE, maxResolution: 0.5 })).toBe(0.5)
  })

  it("changes the canvas key only for settings that need a new canvas", () => {
    const base = canvasKey(DEFAULT_RENDER_PERFORMANCE)
    expect(canvasKey({ ...DEFAULT_RENDER_PERFORMANCE, shadowBlurQuality: 0 })).toBe(base)
    expect(canvasKey({ ...DEFAULT_RENDER_PERFORMANCE, maxResolution: 1 })).toBe(base)
    expect(canvasKey({ ...DEFAULT_RENDER_PERFORMANCE, antialias: false })).not.toBe(base)
    expect(canvasKey({ ...DEFAULT_RENDER_PERFORMANCE, textureScale: 0.5 })).not.toBe(base)
    expect(canvasKey({ ...DEFAULT_RENDER_PERFORMANCE, waterEffect: false })).not.toBe(base)
  })

  it("fills settings saved before one existed with its default", () => {
    expect(withPerformanceDefaults({ antialias: false })).toEqual({
      ...DEFAULT_RENDER_PERFORMANCE,
      antialias: false,
    })
    expect(withPerformanceDefaults(undefined)).toEqual(DEFAULT_RENDER_PERFORMANCE)
  })
})
