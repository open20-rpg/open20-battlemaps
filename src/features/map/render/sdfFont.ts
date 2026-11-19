import { BitmapFont, Cache, Texture, type BitmapFontData } from "pixi.js"
import { cssFont, FALLBACK_FAMILY, type FontChoice } from "../../fonts/catalog"
import { sdfFromCoverage } from "./sdf"

/**
 * Distance-field bitmap fonts for map text: each font's glyphs are drawn
 * once on a canvas at the text quality's size (Settings › Performance:
 * more pixels per glyph, sharper edges zoomed in) and turned into a signed distance
 * field (sdf.ts), so a label is a handful of textured quads that stay sharp
 * at any zoom and size — instead of a canvas text rasterized per label.
 * Atlases cover Latin text up front and are rebuilt with any other
 * character a label needs; kerning is measured per pair as labels use them.
 */

/** Glyph size the atlas is drawn at (the text quality); the rest follows from it. */
let BASE_PX = 64
/** Field reach (px) on each side of a glyph's edge: an eighth of the glyph. */
let RADIUS = 8
/** Margin around each glyph: the field plus a pixel. */
let PAD = RADIUS + 1
/** Atlas width: wide enough for a dozen or more glyphs a row at any size. */
let ATLAS_WIDTH = 1024

/**
 * Draw the atlases at `px` per glyph from now on (Settings › Performance's
 * text quality). A change drops every atlas: call it only while nothing
 * draws text (a new canvas).
 */
export function configureSdfText(px: number): void {
  if (px === BASE_PX) return
  BASE_PX = px
  RADIUS = Math.max(4, Math.round(px / 8))
  PAD = RADIUS + 1
  ATLAS_WIDTH = px <= 64 ? 1024 : px <= 128 ? 2048 : 4096
  for (const atlas of atlases.values()) atlas.font.destroy()
  atlases.clear()
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String.fromCharCode(from + i))
/** Printable ASCII, Latin-1 and common typographic marks. */
const BASE_CHARS = [...range(32, 126), ...range(160, 255), ..."‘’‚“”„–—…•€™"]

interface Atlas {
  name: string
  chars: Set<string>
  font: BitmapFont
  /** Canvas set up with the font, for kerning. */
  ctx: CanvasRenderingContext2D
}

const atlases = new Map<string, Atlas>()
let generation = 0

const canvas2d = (w: number, h: number) => {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("no 2D canvas")
  return { canvas: c, ctx }
}

function buildAtlas(name: string, css: string, chars: string[]): Atlas {
  const measure = canvas2d(1, 1).ctx
  measure.font = css
  const line = measure.measureText("Hg")
  const ascent = line.fontBoundingBoxAscent
  // Lay the glyph cells out in rows.
  const cells = chars.map((ch) => {
    const m = measure.measureText(ch)
    const left = Math.ceil(m.actualBoundingBoxLeft)
    const right = Math.ceil(m.actualBoundingBoxRight)
    const up = Math.ceil(m.actualBoundingBoxAscent)
    const down = Math.ceil(m.actualBoundingBoxDescent)
    return {
      ch,
      left,
      up,
      advance: m.width,
      w: Math.max(0, left + right) + 2 * PAD,
      h: Math.max(0, up + down) + 2 * PAD,
      x: 0,
      y: 0,
    }
  })
  let x = 0
  let y = 0
  let rowH = 0
  for (const c of cells) {
    if (x + c.w > ATLAS_WIDTH) {
      x = 0
      y += rowH
      rowH = 0
    }
    c.x = x
    c.y = y
    x += c.w
    rowH = Math.max(rowH, c.h)
  }
  const height = y + rowH
  const { canvas, ctx } = canvas2d(ATLAS_WIDTH, height)
  ctx.font = css
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = "#fff"
  for (const c of cells) ctx.fillText(c.ch, c.x + PAD + c.left, c.y + PAD + c.up)
  // The coverage becomes the field, kept in alpha (the shader reads alpha).
  const image = ctx.getImageData(0, 0, ATLAS_WIDTH, height)
  const n = ATLAS_WIDTH * height
  const coverage = new Uint8Array(n)
  for (let i = 0; i < n; i++) coverage[i] = image.data[i * 4 + 3]
  const field = sdfFromCoverage(coverage, ATLAS_WIDTH, height, RADIUS)
  for (let i = 0; i < n; i++) {
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 255
    image.data[i * 4 + 3] = field[i]
  }
  ctx.putImageData(image, 0, 0)

  const data: BitmapFontData = {
    chars: Object.fromEntries(
      cells.map((c) => [
        c.ch,
        {
          id: c.ch.codePointAt(0) ?? 0,
          letter: c.ch,
          page: 0,
          x: c.x,
          y: c.y,
          width: c.w,
          height: c.h,
          // Pixi places a glyph from the line's top; the baseline is `ascent` down.
          xOffset: -c.left - PAD,
          yOffset: ascent - c.up - PAD,
          xAdvance: c.advance,
          kerning: {},
        },
      ]),
    ),
    pages: [{ id: 0, file: "" }],
    // Pixi shifts glyphs down by (lineHeight − fontSize) / 2: zero, so the
    // baseline is exactly `ascent` below the top (labels are one line).
    lineHeight: BASE_PX,
    fontSize: BASE_PX,
    fontFamily: name,
    baseLineOffset: 0,
    distanceField: { type: "sdf", range: RADIUS * 2 },
  }
  const font = new BitmapFont({ data, textures: [Texture.from(canvas)] })
  Cache.set(`${name}-bitmap`, font)
  return { name, chars: new Set(chars), font, ctx: measure }
}

/** Measure (once) the kerning of each pair of `text` into the font's glyphs. */
function ensureKerning(atlas: Atlas, text: string): void {
  const chars = [...text]
  for (let i = 1; i < chars.length; i++) {
    const a = chars[i - 1]
    const b = chars[i]
    const glyph = atlas.font.chars[b]
    if (!glyph || a in glyph.kerning) continue
    const ctx = atlas.ctx
    const k = ctx.measureText(a + b).width - ctx.measureText(a).width - ctx.measureText(b).width
    glyph.kerning[a] = Math.abs(k) < 0.01 ? 0 : k
  }
}

/**
 * The bitmap font (its name, for BitmapText's fontFamily) that draws
 * `text` in `font` — the fallback family while `font` isn't loaded — and
 * the size it was drawn at.
 */
export function sdfFont(font: FontChoice, ready: boolean, text: string): string {
  const face: FontChoice = ready ? font : { ...font, family: "" }
  const css = cssFont(face, BASE_PX)
  let atlas = atlases.get(css)
  const missing = [...text].filter((ch) => !atlas?.chars.has(ch))
  if (!atlas || missing.length > 0) {
    // A new atlas under a new name: labels still showing the old one keep it.
    const chars = [...new Set([...(atlas?.chars ?? BASE_CHARS), ...missing])]
    atlas = buildAtlas(`sdf${++generation}:${face.family || FALLBACK_FAMILY}`, css, chars)
    atlases.set(css, atlas)
  }
  ensureKerning(atlas, text)
  return atlas.name
}
