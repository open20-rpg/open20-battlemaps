import { describe, expect, it } from "vitest"
import { bytesToBase64 } from "./base64"

describe("bytesToBase64", () => {
  it("encodes small and chunk-crossing buffers", () => {
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe("AQID")
    const big = new Uint8Array(100_000).map((_, i) => i % 251)
    const back = Uint8Array.from(atob(bytesToBase64(big)), (c) => c.charCodeAt(0))
    expect(back).toEqual(big)
  })
})
