import { describe, expect, it } from "vitest"
import {
  LIBRARY_MAX_COLUMNS,
  LIBRARY_MIN_COLUMNS,
  libraryColumnsFor,
  libraryWidth,
} from "./panelWidth"

describe("Library panel width", () => {
  it("keeps the default 4-column width", () => {
    expect(libraryWidth(LIBRARY_MIN_COLUMNS)).toBe(332)
  })

  it("grows one thumbnail column at a time, up to 8", () => {
    expect(libraryWidth(5) - libraryWidth(4)).toBe(72)
    expect(libraryWidth(12)).toBe(libraryWidth(LIBRARY_MAX_COLUMNS))
    expect(libraryWidth(1)).toBe(libraryWidth(LIBRARY_MIN_COLUMNS))
  })

  it("snaps a dragged width to the nearest column count", () => {
    for (let n = LIBRARY_MIN_COLUMNS; n <= LIBRARY_MAX_COLUMNS; n++) {
      expect(libraryColumnsFor(libraryWidth(n))).toBe(n)
      expect(libraryColumnsFor(libraryWidth(n) + 30)).toBe(n)
      expect(libraryColumnsFor(libraryWidth(n) - 30)).toBe(n)
    }
    expect(libraryColumnsFor(100)).toBe(LIBRARY_MIN_COLUMNS)
    expect(libraryColumnsFor(5000)).toBe(LIBRARY_MAX_COLUMNS)
  })
})
