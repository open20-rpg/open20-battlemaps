import { describe, expect, it } from "vitest"
import {
  asFont,
  boxRadius,
  frameOf,
  layoutTextBox,
  NO_FRAME,
  textStyle,
  type TextFrame,
} from "./metrics"

describe("text box layout", () => {
  const m = { textW: 100, space: 9, ascent: 30, descent: 8 }
  const frame = (border: number, pad: Partial<TextFrame> = {}): TextFrame => ({
    ...NO_FRAME,
    border,
    ...pad,
  })

  it("frames the text with a space and the border", () => {
    expect(layoutTextBox(m, NO_FRAME)).toMatchObject({ w: 109, h: 38, textX: 4, baseline: 30 })
    // bw = 3: W = 100 + 9 + 6, text at bw + floor(space / 2).
    expect(layoutTextBox(m, frame(3))).toMatchObject({ w: 115, h: 44, textX: 7, baseline: 33 })
  })

  it("keeps the text inside the border even with no space", () => {
    expect(layoutTextBox({ ...m, space: 0 }, frame(5)).textX).toBe(5)
  })

  it("pads each side on its own", () => {
    const box = layoutTextBox(m, frame(0, { top: 4, right: 10, bottom: 6, left: 20 }))
    expect(box).toMatchObject({ w: 139, h: 48, textX: 24, baseline: 34 })
    expect(box.bounds).toEqual({ x: 0, y: 0, w: 139, h: 48 })
  })

  it("lets a negative padding pull the box in, the text sticking out", () => {
    const box = layoutTextBox(m, frame(2, { top: -10, left: -30, right: -30 }))
    expect(box).toMatchObject({ w: 53, h: 32, textX: -24, baseline: 22 })
    // Drawn: from the text's left edge to the box's or text's far side.
    expect(box.bounds).toEqual({ x: -24, y: -8, w: 100, h: 40 })
  })
})

describe("text style", () => {
  it("reads params with their defaults", () => {
    expect(textStyle({})).toMatchObject({ size: 32, box: false, radius: 0, borderWidth: 2 })
  })

  it("reads labels saved with a box shape: a pill is fully rounded", () => {
    expect(textStyle({ boxShape: "pill", fontSize: 20 })).toMatchObject({
      box: true,
      radius: 100,
      size: 20,
    })
    expect(textStyle({ boxShape: "rectangle" })).toMatchObject({ box: true, radius: 0 })
    // Today's params win over the old shape.
    expect(textStyle({ boxShape: "pill", box: false, boxRadius: 40 })).toMatchObject({
      box: false,
      radius: 40,
    })
  })

  it("rounds corners by a share of the shorter side's half", () => {
    const style = textStyle({ box: true, boxRadius: 50 })
    expect(boxRadius(style, { w: 100, h: 40 })).toBe(10)
    expect(frameOf(textStyle({ boxPadLeft: 8 })).left).toBe(0)
    expect(frameOf(textStyle({ box: true, boxPadLeft: -8 })).left).toBe(-8)
  })

  it("reads old maps' font family strings", () => {
    expect(asFont("Georgia")).toEqual({ family: "Georgia", weight: 400, italic: false })
    expect(asFont({ family: "Roboto", weight: 700, italic: true }).weight).toBe(700)
  })
})
