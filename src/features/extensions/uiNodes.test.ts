import { describe, expect, it } from "vitest"
import { callSafely, nodeKey } from "./uiNodes"

describe("uiNodes", () => {
  it("keeps a key per node object", () => {
    const a = { type: "divider" }
    expect(nodeKey(a)).toBe(nodeKey(a))
    expect(nodeKey(a)).not.toBe(nodeKey({ type: "divider" }))
  })
  it("swallows failing callbacks", async () => {
    callSafely(() => Promise.reject(new Error("x")))
    callSafely("not a function")
    await new Promise((r) => setTimeout(r, 0))
  })
})
