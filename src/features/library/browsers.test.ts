import { describe, expect, it, vi } from "vitest"
import { type LibItem } from "./api"
import { indexOfAsset, registerLibraryBrowser, stepLibraryAsset } from "./browsers"

const item = (id: string): LibItem => ({ id, name: id, thumb: "", full: "", colorable: false })

vi.mock("./api", () => ({
  getLibraryItems: vi.fn((_key: string, offset: number) => Promise.resolve([item(`far${offset}`)])),
}))

describe("library browsers (next asset)", () => {
  it("steps through the grid's order, wrapping and fetching unloaded pages", async () => {
    const items = new Map([
      [0, item("a")],
      [1, item("b")],
    ])
    const unregister = registerLibraryBrowser("objects", { key: "k", items, total: 4 })
    expect(indexOfAsset(items, "b")).toBe(1)
    expect(await stepLibraryAsset("objects", "a", 1)).toBe("b")
    expect(await stepLibraryAsset("objects", "a", -1)).toBe("far3")
    expect(items.get(3)?.id).toBe("far3")
    expect(await stepLibraryAsset("objects", "unknown", 1)).toBe("a")
    unregister()
    expect(await stepLibraryAsset("objects", "a", 1)).toBeNull()
  })
})
