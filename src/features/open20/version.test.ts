import { describe, expect, it } from "vitest"
import { isNewer } from "./version"

describe("isNewer", () => {
  it("compares numerically, part by part", () => {
    expect(isNewer("0.3.54", "0.3.53")).toBe(true)
    expect(isNewer("0.10.0", "0.9.9")).toBe(true)
    expect(isNewer("1.0.0", "0.99.99")).toBe(true)
    expect(isNewer("0.3.53", "0.3.53")).toBe(false)
    expect(isNewer("0.3.52", "0.3.53")).toBe(false)
  })

  it("tolerates a leading v, missing parts and suffixes", () => {
    expect(isNewer("v0.4", "0.3.99")).toBe(true)
    expect(isNewer("0.4.0", "0.4")).toBe(false)
    expect(isNewer("0.4.0-beta", "0.3.0")).toBe(true)
  })
})
