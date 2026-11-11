import { describe, expect, it } from "vitest"
import { formatShortcut, matchesShortcut, withShortcut } from "./shortcuts"

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
})

describe("shortcuts", () => {
  it("matches the key case-insensitively, with Shift exactly as declared", () => {
    expect(matchesShortcut(key("w"), { key: "w" })).toBe(true)
    expect(matchesShortcut(key("W", { shiftKey: true }), { key: "w" })).toBe(false)
    expect(matchesShortcut(key("G", { shiftKey: true }), { key: "g", shift: true })).toBe(true)
    expect(matchesShortcut(key("g"), { key: "g", shift: true })).toBe(false)
  })

  it("never matches Ctrl/Cmd/Alt combos", () => {
    expect(matchesShortcut(key("w", { ctrlKey: true }), { key: "w" })).toBe(false)
    expect(matchesShortcut(key("w", { metaKey: true }), { key: "w" })).toBe(false)
    expect(matchesShortcut(key("w", { altKey: true }), { key: "w" })).toBe(false)
  })

  it("formats for tooltips", () => {
    expect(formatShortcut({ key: "g", shift: true })).toBe("Shift+G")
    expect(withShortcut("Wall", { key: "w" })).toBe("Wall (W)")
    expect(withShortcut("Wall", undefined)).toBe("Wall")
  })
})
