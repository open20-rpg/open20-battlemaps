import { describe, expect, it } from "vitest"
import { useMapFileStore, usableMapId } from "./mapFileStore"

describe("map ids", () => {
  it("accepts only ids that can name a backups folder", () => {
    expect(usableMapId("mabc-12_x")).toBe("mabc-12_x")
    expect(usableMapId("../x")).toBeNull()
    expect(usableMapId("")).toBeNull()
    expect(usableMapId(42)).toBeNull()
    expect(usableMapId("a".repeat(65))).toBeNull()
  })

  it("keeps a loaded map's id, or gives it a new one", () => {
    const store = useMapFileStore.getState()
    store.setLoaded("/a.otbm", "2026-01-01", "0.1.0", "mkeep")
    expect(useMapFileStore.getState().mapId).toBe("mkeep")
    store.setLoaded("/b.otbm", "2026-01-01", "0.1.0", "bad/id")
    const fresh = useMapFileStore.getState().mapId
    expect(usableMapId(fresh)).toBe(fresh)
    expect(fresh).not.toBe("bad/id")
  })
})
