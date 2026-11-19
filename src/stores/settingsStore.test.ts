import { describe, expect, it } from "vitest"
import { migrateSettings, SETTINGS_VERSION } from "./settingsStore"

describe("settings migration", () => {
  it("drops the graphics saved before presets, keeping everything else", () => {
    const saved = { performance: { maxResolution: 3 }, prefabs: [1], panelAlpha: 0.5 }
    expect(migrateSettings(saved, 1)).toEqual({ prefabs: [1], panelAlpha: 0.5 })
    expect(migrateSettings(saved, 0)).not.toHaveProperty("performance")
  })

  it("resets the graphics again in version 3, and moving a snapshot", () => {
    const saved = { performance: { maxResolution: 1 }, snapshotViewGestures: true, prefabs: [] }
    expect(migrateSettings(saved, 2)).toEqual({ prefabs: [] })
  })

  it("leaves current settings alone", () => {
    const saved = { performance: { maxResolution: 1 } }
    expect(migrateSettings(saved, SETTINGS_VERSION)).toBe(saved)
  })
})
