import { describe, expect, it } from "vitest"
import { asFont, layoutTextBox, textStyle } from "./metrics"

describe("text box layout", () => {
  const m = { textW: 100, space: 9, ascent: 30, descent: 8 }

  it("frames the text with a space and the border", () => {
    expect(layoutTextBox(m, 0)).toEqual({ w: 109, h: 38, textX: 4, baseline: 30 })
    // bw = 3: W = 100 + 9 + 6, text at bw + floor(space / 2).
    expect(layoutTextBox(m, 3)).toEqual({ w: 115, h: 44, textX: 7, baseline: 33 })
  })

  it("keeps the text inside the border even with no space", () => {
    expect(layoutTextBox({ ...m, space: 0 }, 5).textX).toBe(5)
  })
})

describe("text style", () => {
  it("reads params with Dungeondraft's defaults", () => {
    expect(textStyle({})).toMatchObject({ size: 32, box: "none", borderWidth: 2 })
    expect(textStyle({ boxShape: "pill", fontSize: 20 })).toMatchObject({ box: "pill", size: 20 })
  })

  it("reads old maps' font family strings", () => {
    expect(asFont("Georgia")).toEqual({ family: "Georgia", weight: 400, italic: false })
    expect(asFont({ family: "Roboto", weight: 700, italic: true }).weight).toBe(700)
  })
})
