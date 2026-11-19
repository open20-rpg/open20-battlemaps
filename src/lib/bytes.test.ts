import { describe, expect, it } from "vitest"
import { formatBytes } from "./bytes"

describe("formatBytes", () => {
  it("picks the unit and keeps a decimal from MB up", () => {
    expect(formatBytes(0, "en")).toBe("0 B")
    expect(formatBytes(1536, "en")).toBe("2 KB")
    expect(formatBytes(5 * 1024 ** 2, "en")).toBe("5.0 MB")
    expect(formatBytes(1.25 * 1024 ** 3, "es")).toBe("1,3 GB")
  })
})
