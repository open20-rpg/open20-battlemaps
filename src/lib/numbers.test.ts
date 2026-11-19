import { describe, expect, it } from "vitest"
import { formatStep, roundTo, stepDecimals } from "./numbers"

describe("roundTo", () => {
  it("keeps at most the given decimals", () => {
    expect(roundTo(1.3333333333)).toBe(1.33)
    expect(roundTo(2.625, 1)).toBe(2.6)
    expect(roundTo(1.5)).toBe(1.5)
    expect(roundTo(1317.3333, 0)).toBe(1317)
  })
})

describe("formatStep", () => {
  it("rounds to the step's decimals", () => {
    expect(formatStep(1.1872385908979666, 0.01)).toBe("1.19")
    expect(formatStep(37.6, 1)).toBe("38")
    expect(formatStep(0.25, 0.25)).toBe("0.25")
    expect(formatStep(2, 0.1)).toBe("2")
    expect(stepDecimals(1e-7)).toBe(7)
  })
})
