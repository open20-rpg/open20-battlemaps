import { cssFont, DEFAULT_FONT, type FontChoice } from "./catalog"

/**
 * A text label's box and how it is laid out. Everything is measured
 * in the font at font_size px, then ×4 is world px (256 per tile): 1 em is
 * 4·font_size world px, font_size / 64 tiles.
 */

/** World px per font px. */
export const WORLD_PX_PER_FONT_PX = 4
/** Font px per tile (256 world px ÷ 4). */
export const FONT_PX_PER_TILE = 64

/** The font's measures at font_size px. */
export interface FontMeasures {
  /** The text's width: advances plus kerning. */
  textW: number
  /** The space's advance. */
  space: number
  ascent: number
  /** Below the baseline, positive. */
  descent: number
}

/** A box's border and padding around the text, in font px (padding may be negative). */
export interface TextFrame {
  border: number
  top: number
  right: number
  bottom: number
  left: number
}

/** No box: the text alone. */
export const NO_FRAME: TextFrame = { border: 0, top: 0, right: 0, bottom: 0, left: 0 }

/** A rectangle in font px, from the box's top-left corner. */
export interface FontRect {
  x: number
  y: number
  w: number
  h: number
}

/** The box in font px, from its top-left corner. */
export interface TextBoxLayout {
  w: number
  h: number
  /** Where the text starts. */
  textX: number
  /** The baseline. */
  baseline: number
  /** What's drawn: the box and the text, which a negative padding lets stick out of it. */
  bounds: FontRect
}

/**
 * W = textW + space + 2·bw + left + right, H = ascent + descent + 2·bw +
 * top + bottom (never smaller than the border); the text at
 * x = left + floor(space / 2 + bw), its baseline at bw + top + ascent.
 */
export function layoutTextBox(m: FontMeasures, frame: TextFrame): TextBoxLayout {
  const bw = Math.max(0, frame.border)
  const w = Math.max(2 * bw, m.textW + m.space + 2 * bw + frame.left + frame.right)
  const h = Math.max(2 * bw, m.ascent + m.descent + 2 * bw + frame.top + frame.bottom)
  const textX = frame.left + Math.floor(m.space / 2 + bw)
  const baseline = bw + frame.top + m.ascent
  const x0 = Math.min(0, textX)
  const y0 = Math.min(0, baseline - m.ascent)
  const x1 = Math.max(w, textX + m.textW)
  const y1 = Math.max(h, baseline + m.descent)
  return { w, h, textX, baseline, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }
}

/** What a text entity's look is made of (its params, read leniently). */
export interface TextStyle {
  font: FontChoice
  size: number
  color: string
  /** Whether it has a box (background, border, padding). */
  box: boolean
  /** Corner rounding, % of the half of the box's shorter side (100: a pill). */
  radius: number
  /** Padding inside the box, font px (negative: the text sticks out). */
  pad: { top: number; right: number; bottom: number; left: number }
  borderWidth: number
  background: string
  borderColor: string
}

const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback)
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback)

export function asFont(v: unknown): FontChoice {
  if (typeof v === "string") return { ...DEFAULT_FONT, family: v }
  if (!v || typeof v !== "object") return DEFAULT_FONT
  const f = v as Partial<FontChoice>
  return {
    family: typeof f.family === "string" ? f.family : "",
    weight: num(f.weight, 400),
    italic: f.italic === true,
  }
}

/**
 * A label's box params, resolved: labels saved before (and Dungeondraft's)
 * have a `boxShape` instead: a rectangle has no rounding, a pill all of it.
 */
export function textBoxParams(params: Record<string, unknown>) {
  const shape = params.boxShape
  return {
    box: typeof params.box === "boolean" ? params.box : shape === "rectangle" || shape === "pill",
    boxRadius: num(params.boxRadius, shape === "pill" ? 100 : 0),
    boxPadTop: num(params.boxPadTop, 0),
    boxPadRight: num(params.boxPadRight, 0),
    boxPadBottom: num(params.boxPadBottom, 0),
    boxPadLeft: num(params.boxPadLeft, 0),
  }
}

export function textStyle(params: Record<string, unknown>): TextStyle {
  const b = textBoxParams(params)
  return {
    font: asFont(params.font),
    size: num(params.fontSize, 32),
    color: str(params.fontColor, "#000000"),
    box: b.box,
    radius: Math.min(100, Math.max(0, b.boxRadius)),
    pad: { top: b.boxPadTop, right: b.boxPadRight, bottom: b.boxPadBottom, left: b.boxPadLeft },
    borderWidth: num(params.boxBorderWidth, 2),
    background: str(params.boxColor, "#ffffff"),
    borderColor: str(params.boxBorderColor, "#000000"),
  }
}

/** The border and padding that count in the layout: none without a box. */
export const frameOf = (s: TextStyle): TextFrame =>
  s.box ? { border: Math.max(0, s.borderWidth), ...s.pad } : NO_FRAME

/** A box's corner radius, font px. */
export const boxRadius = (s: TextStyle, box: { w: number; h: number }): number =>
  ((s.radius / 100) * Math.min(box.w, box.h)) / 2

let canvas: CanvasRenderingContext2D | null | undefined
const context = (): CanvasRenderingContext2D | null => {
  if (canvas === undefined) {
    canvas =
      typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d")
  }
  return canvas
}

const fontCache = new Map<string, Omit<FontMeasures, "textW">>()

/**
 * The font's measures for `text` at `size` px (canvas measuring; a rough
 * estimate where there's no canvas, e.g. tests).
 */
export function measureText(font: FontChoice, size: number, text: string): FontMeasures {
  const ctx = context()
  if (!ctx) {
    return {
      textW: text.length * size * 0.55,
      space: size * 0.25,
      ascent: size * 0.8,
      descent: size * 0.2,
    }
  }
  const css = cssFont(font, size)
  ctx.font = css
  let base = fontCache.get(css)
  if (!base) {
    const m = ctx.measureText("Hg")
    base = {
      space: ctx.measureText(" ").width,
      ascent: m.fontBoundingBoxAscent ?? size * 0.8,
      descent: m.fontBoundingBoxDescent ?? size * 0.2,
    }
    fontCache.set(css, base)
  }
  return { textW: ctx.measureText(text).width, ...base }
}

/** Forget measures taken before a font finished loading (they used the fallback). */
export const clearMeasures = (): void => fontCache.clear()

/** A text entity's box, in font px. */
export function textLayout(params: Record<string, unknown>, text: string): TextBoxLayout {
  const style = textStyle(params)
  return layoutTextBox(measureText(style.font, style.size, text), frameOf(style))
}
