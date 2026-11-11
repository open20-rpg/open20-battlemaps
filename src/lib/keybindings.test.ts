import { describe, expect, it } from "vitest"
import {
  chordOf,
  findConflicts,
  isHoldBinding,
  matchesBinding,
  normalizeChord,
} from "./keybindings"

const ev = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe("keybindings", () => {
  it("builds chords with modifiers in a fixed order", () => {
    expect(chordOf(ev("z", { ctrlKey: true }))).toBe("Ctrl+Z")
    expect(chordOf(ev("S", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+S")
    expect(chordOf(ev("Enter", { altKey: true }))).toBe("Alt+Enter")
    expect(chordOf(ev(" "))).toBe("Space")
    expect(chordOf(ev("PageUp"))).toBe("PageUp")
    // Cmd on macOS counts as Ctrl.
    expect(chordOf(ev("o", { metaKey: true }))).toBe("Ctrl+O")
  })

  it("treats a lone modifier as its own chord (a hold)", () => {
    expect(chordOf(ev("Alt", { altKey: true }))).toBe("Alt")
    expect(isHoldBinding("Alt")).toBe(true)
    expect(isHoldBinding("Space")).toBe(true)
    expect(isHoldBinding("MouseMiddle")).toBe(true)
    expect(isHoldBinding("G")).toBe(false)
  })

  it("ignores Shift on symbol keys, whatever the layout", () => {
    // "{" is Shift+[ on US layouts and a plain key on others.
    expect(chordOf(ev("{", { shiftKey: true }))).toBe("{")
    expect(matchesBinding(ev("{"), "{")).toBe(true)
    expect(matchesBinding(ev("+", { ctrlKey: true, shiftKey: true }), "Ctrl++")).toBe(true)
    // Letters keep their Shift.
    expect(matchesBinding(ev("G", { shiftKey: true }), "G")).toBe(false)
  })

  it("normalizes typed bindings", () => {
    expect(normalizeChord("shift+ctrl+s")).toBe("Ctrl+Shift+S")
    expect(normalizeChord("Ctrl++")).toBe("Ctrl++")
    expect(normalizeChord("Ctrl+=")).toBe("Ctrl+=")
  })

  it("finds conflicts between actions and with fixed chords", () => {
    const conflicts = findConflicts({ grid: ["G"], ruler: ["R", "g"], copy: ["Ctrl+C"] }, [
      "Ctrl+C",
      "Escape",
    ])
    expect(conflicts.get("G")).toEqual(["grid", "ruler"])
    expect(conflicts.get("Ctrl+C")).toEqual(["fixed", "copy"])
    expect(conflicts.has("Escape")).toBe(false)
  })
})
