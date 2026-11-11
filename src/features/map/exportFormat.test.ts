import { describe, expect, it } from "vitest"
import { estimateBytes, formatBytes, supportsTransparency } from "./exportFormat"

describe("export format helpers", () => {
  it("scales a sample's bytes per pixel to the image", () => {
    expect(estimateBytes(1000, 100, 100)).toBe(1000)
    expect(estimateBytes(1000, 100, 400)).toBe(4000)
    expect(estimateBytes(1000, 0, 400)).toBe(0)
  })

  it("formats sizes", () => {
    expect(formatBytes(900)).toBe("900 B")
    expect(formatBytes(2048)).toBe("2 KB")
    expect(formatBytes(12.34 * 1024 * 1024)).toBe("12.3 MB")
  })

  it("only JPEG drops transparency", () => {
    expect(supportsTransparency("png")).toBe(true)
    expect(supportsTransparency("jpeg")).toBe(false)
  })
})
