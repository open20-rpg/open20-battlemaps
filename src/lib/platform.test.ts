import { describe, expect, it } from "vitest"
import { isMobilePlatform } from "./platform"

describe("isMobilePlatform", () => {
  it("detects Android and iOS", () => {
    expect(isMobilePlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) wv" })).toBe(
      true,
    )
    expect(
      isMobilePlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }),
    ).toBe(true)
  })

  it("takes a touch Mac for an iPad", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
    expect(isMobilePlatform({ userAgent: ua, maxTouchPoints: 5 })).toBe(true)
    expect(isMobilePlatform({ userAgent: ua, maxTouchPoints: 0 })).toBe(false)
  })

  it("is false on desktop", () => {
    expect(
      isMobilePlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" }),
    ).toBe(false)
    expect(isMobilePlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false)
    expect(isMobilePlatform(undefined)).toBe(false)
  })
})
