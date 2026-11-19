import { describe, expect, it } from "vitest"
import {
  cachedFileName,
  cssFont,
  fontFile,
  fontFileName,
  fontUrl,
  nearestStyle,
  parseFontName,
  parseStyle,
  styleName,
  type CatalogFamily,
} from "./catalog"
import catalog from "./catalog.json"

const families: CatalogFamily[] = [
  {
    f: "Libre Baskerville",
    d: "ofl/librebaskerville",
    files: ["LibreBaskerville[wght].ttf", "LibreBaskerville-Italic[wght].ttf"],
    s: [
      [400, 0, 0],
      [700, 0, 0],
      [400, 1, 1],
      [700, 1, 1],
    ],
  },
  { f: "Libre", d: "ofl/libre", files: ["Libre-Regular.ttf"], s: [[400, 0, 0]] },
  { f: "Bangers", d: "ofl/bangers", files: ["Bangers-Regular.ttf"], s: [[400, 0, 0]] },
]

describe("font styles", () => {
  it("names styles as Google Fonts does", () => {
    expect(styleName(400, false)).toBe("Regular")
    expect(styleName(400, true)).toBe("Italic")
    expect(styleName(700, false)).toBe("Bold")
    expect(styleName(700, true)).toBe("Bold Italic")
  })

  it("parses style names into weight and slant", () => {
    expect(parseStyle("")).toEqual({ weight: 400, italic: false })
    expect(parseStyle(" Bold")).toEqual({ weight: 700, italic: false })
    expect(parseStyle("Italic")).toEqual({ weight: 400, italic: true })
    expect(parseStyle("Semi Bold Italic")).toEqual({ weight: 600, italic: true })
    expect(parseStyle("Display")).toBeNull()
  })
})

describe("imported font_name", () => {
  it("is the family for Regular, family + style otherwise", () => {
    expect(parseFontName("Libre Baskerville", families)).toEqual({
      family: "Libre Baskerville",
      weight: 400,
      italic: false,
    })
    expect(parseFontName("Libre Baskerville Bold", families)).toEqual({
      family: "Libre Baskerville",
      weight: 700,
      italic: false,
    })
    expect(parseFontName("Libre Baskerville Bold Italic", families)?.italic).toBe(true)
  })

  it("prefers the longest family and needs a known style after it", () => {
    expect(parseFontName("Libre", families)?.family).toBe("Libre")
    expect(parseFontName("Libre Display", families)).toBeNull()
    expect(parseFontName("Comic Sans", families)).toBeNull()
  })

  it("finds the Google families imported maps use", () => {
    const all = catalog as CatalogFamily[]
    for (const name of ["Libre Baskerville Bold", "Bangers", "Roboto", "Germania One"])
      expect(parseFontName(name, all), name).not.toBeNull()
  })
})

describe("font files", () => {
  const [baskerville] = families

  it("picks the nearest style of the same slant", () => {
    expect(nearestStyle(baskerville, 600, true)).toEqual([700, 1, 1])
    expect(nearestStyle(families[2], 700, true)).toEqual([400, 0, 0])
  })

  it("downloads from google/fonts and caches as Family-Style.ttf", () => {
    expect(fontUrl(baskerville, 700, true)).toBe(
      "https://raw.githubusercontent.com/google/fonts/main/ofl/librebaskerville/LibreBaskerville-Italic%5Bwght%5D.ttf",
    )
    expect(fontFileName({ family: "Libre Baskerville", weight: 700, italic: true })).toBe(
      "LibreBaskerville-BoldItalic.ttf",
    )
  })

  it("caches a variable font's file once, for every weight of its slant", () => {
    const face = fontFile(baskerville, 700, true)
    expect(face).toEqual({ file: 1, italic: true, weights: [400, 700], variable: true })
    expect(fontFile(baskerville, 400, true)).toEqual(face)
    expect(cachedFileName(baskerville, face)).toBe("LibreBaskerville-VariableItalic.ttf")
    expect(cachedFileName(baskerville, fontFile(baskerville, 400, false))).toBe(
      "LibreBaskerville-Variable.ttf",
    )
  })

  it("keeps a static font's file per style", () => {
    const lato: CatalogFamily = {
      f: "Lato",
      d: "ofl/lato",
      files: ["Lato-Regular.ttf", "Lato-Bold.ttf"],
      s: [
        [400, 0, 0],
        [700, 0, 1],
      ],
    }
    const bold = fontFile(lato, 650, false)
    expect(bold).toEqual({ file: 1, italic: false, weights: [700, 700], variable: false })
    expect(cachedFileName(lato, bold)).toBe("Lato-Bold.ttf")
  })

  it("falls back to the default family", () => {
    const font = { family: "Bangers", weight: 400, italic: false }
    expect(cssFont(font, 32)).toBe('400 32px "Bangers", sans-serif')
    expect(cssFont(font, 32, false)).toBe("400 32px sans-serif")
  })
})
