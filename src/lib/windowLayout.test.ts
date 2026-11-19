import { describe, expect, it } from "vitest"
import { keepOnScreen, openingRect, WINDOW_MARGIN } from "./windowLayout"

describe("floating window layout", () => {
  it("opens centered at its size when it fits", () => {
    expect(openingRect({ w: 1280, h: 800 }, { w: 600, h: 500 }, { w: 300, h: 200 })).toEqual({
      x: 340,
      y: 150,
      w: 600,
      h: 500,
    })
  })

  it("shrinks to a phone's screen, keeping a margin", () => {
    const r = openingRect({ w: 390, h: 800 }, { w: 760, h: 560 }, { w: 560, h: 320 })
    expect(r.w).toBe(390 - 2 * WINDOW_MARGIN)
    expect(r.x).toBe(WINDOW_MARGIN)
    expect(r.h).toBe(560)
  })

  it("keeps a requested position on screen", () => {
    const r = openingRect(
      { w: 1000, h: 700 },
      { w: 500, h: 400 },
      { w: 300, h: 200 },
      {
        x: 900,
        y: -50,
      },
    )
    expect(r).toEqual({ x: 1000 - 500 - WINDOW_MARGIN, y: WINDOW_MARGIN, w: 500, h: 400 })
  })

  it("moves a window that ended up off screen back in", () => {
    expect(keepOnScreen({ w: 800, h: 600 }, { x: 700, y: 500, w: 300, h: 200 })).toEqual({
      x: 800 - 300 - WINDOW_MARGIN,
      y: 600 - 200 - WINDOW_MARGIN,
      w: 300,
      h: 200,
    })
  })
})
