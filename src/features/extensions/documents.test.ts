import { describe, expect, it } from "vitest"
import { missingExtensions } from "./documents"

describe("missingExtensions", () => {
  it("lists what a map needs that isn't ready", () => {
    const uses = [
      { id: "a.ok", version: "1.0.0" },
      { id: "a.gone", version: "1.0.0" },
      { id: "a.off", version: "1.0.0" },
      { id: "a.old", version: "2.1.0" },
    ]
    const installed = {
      "a.ok": { version: "1.2.0", enabled: true },
      "a.off": { version: "1.0.0", enabled: false },
      "a.old": { version: "2.0.0", enabled: true },
    }
    expect(missingExtensions(uses, installed)).toEqual([
      { id: "a.gone", reason: "missing" },
      { id: "a.off", reason: "disabled" },
      { id: "a.old", reason: "older" },
    ])
  })
})
