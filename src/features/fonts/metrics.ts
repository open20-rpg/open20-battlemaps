import { cssFont, DEFAULT_FONT, type FontChoice } from "./catalog"

/**
 * A text label's box, as Dungeondraft lays it out. Everything is measured
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

/** The box in font px, from its top-left corner. */
export interface TextBoxLayout {
  w: number
  h: number
  /** Where the text starts. */
  textX: number
  /** The baseline. */
  baseline: number
}

/**
 * W = textW + space + 2·bw, H = ascent + descent + 2·bw; the text at
 * x = max(bw, floor((W − textW) / 2)), its baseline at bw + ascent.
 * `bw` (the border) counts only when there's a box.
 */
export function layoutTextBox(m: FontMeasures, borderWidth: number): TextBoxLayout {
  const bw = Math.max(0, borderWidth)
  const w = m.textW + m.space + 2 * bw
  const h = m.ascent + m.descent + 2 * bw
  return {
    w,
    h,
    textX: Math.max(bw, Math.floor((w - m.textW) / 2)),
    baseline: bw + m.ascent,
  }
}

/** What a text entity's look is made of (its params, read leniently). */
export interface TextStyle {
  font: FontChoice
  size: number
  color: string
  box: "none" | "rectangle" | "pill"
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

export function textStyle(params: Record<string, unknown>): TextStyle {
  const box = params.boxShape
  return {
    font: asFont(params.font),
    size: num(params.fontSize, 32),
    color: str(params.fontColor, "#000000"),
    box: box === "rectangle" || box === "pill" ? box : "none",
    borderWidth: num(params.boxBorderWidth, 2),
    background: str(params.boxColor, "#ffffff"),
    borderColor: str(params.boxBorderColor, "#000000"),
  }
}

/** The border that counts in the layout: none without a box. */
export const borderOf = (s: TextStyle): number => (s.box === "none" ? 0 : s.borderWidth)

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
  return layoutTextBox(measureText(style.font, style.size, text), borderOf(style))
}
