import { describe, expect, it } from "vitest"
import { roundTo } from "./numbers"

describe("roundTo", () => {
  it("keeps at most the given decimals", () => {
    expect(roundTo(1.3333333333)).toBe(1.33)
    expect(roundTo(2.625, 1)).toBe(2.6)
    expect(roundTo(1.5)).toBe(1.5)
    expect(roundTo(1317.3333, 0)).toBe(1317)
  })
})
