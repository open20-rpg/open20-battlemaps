import { describe, expect, it } from "vitest"
import { keepOnScreen, OPEN_FILL, openingRect, WINDOW_MARGIN } from "./windowLayout"

const room = (v: number) => v - 2 * WINDOW_MARGIN

describe("floating window layout", () => {
  it("opens centered, using most of a wide screen", () => {
    const r = openingRect(
      { w: 1920, h: 1080 },
      { size: { w: 760, h: 560 }, min: { w: 300, h: 200 } },
    )
    expect(r.w).toBe(Math.round(room(1920) * OPEN_FILL))
    expect(r.h).toBe(Math.round(room(1080) * OPEN_FILL))
    expect(r.x).toBe((1920 - r.w) / 2)
    expect(r.y).toBe((1080 - r.h) / 2)
  })

  it("never opens smaller than its preferred size", () => {
    const r = openingRect(
      { w: 1280, h: 800 },
      { size: { w: 1200, h: 500 }, min: { w: 300, h: 200 } },
    )
    expect(r.w).toBe(1200)
    expect(r.h).toBe(Math.round(room(800) * OPEN_FILL))
  })

  it("stops at its largest size", () => {
    const r = openingRect(
      { w: 2560, h: 1440 },
      { size: { w: 600, h: 680 }, min: { w: 300, h: 200 }, max: { w: 760, h: 860 } },
    )
    expect(r).toEqual({ x: (2560 - 760) / 2, y: (1440 - 860) / 2, w: 760, h: 860 })
  })

  it("shrinks to a phone's screen, keeping a margin", () => {
    const r = openingRect({ w: 390, h: 800 }, { size: { w: 760, h: 560 }, min: { w: 560, h: 320 } })
    expect(r.w).toBe(room(390))
    expect(r.x).toBe(WINDOW_MARGIN)
  })

  it("keeps a requested position on screen", () => {
    const r = openingRect(
      { w: 1000, h: 700 },
      {
        size: { w: 500, h: 400 },
        min: { w: 300, h: 200 },
        max: { w: 500, h: 400 },
        at: { x: 900, y: -50 },
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
