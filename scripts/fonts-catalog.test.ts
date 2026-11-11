import { describe, expect, it } from "vitest"
import { familyStyles, parseMetadata } from "./fonts-catalog.mjs"

const VARIABLE = `name: "Libre Baskerville"
fonts {
  name: "Libre Baskerville"
  style: "normal"
  weight: 400
  filename: "LibreBaskerville[wght].ttf"
}
fonts {
  name: "Libre Baskerville"
  style: "italic"
  weight: 400
  filename: "LibreBaskerville-Italic[wght].ttf"
}
axes {
  tag: "wght"
  min_value: 400.0
  max_value: 700.0
}
`

const STATIC = `name: "Bangers"
fonts {
  name: "Bangers"
  style: "normal"
  weight: 400
  filename: "Bangers-Regular.ttf"
}
`

describe("fonts catalog", () => {
  it("reads a METADATA.pb", () => {
    expect(parseMetadata(VARIABLE)).toEqual({
      family: "Libre Baskerville",
      fonts: [
        { style: "normal", weight: 400, filename: "LibreBaskerville[wght].ttf" },
        { style: "italic", weight: 400, filename: "LibreBaskerville-Italic[wght].ttf" },
      ],
      wght: [400, 700],
    })
  })

  it("offers every hundred of a variable font's weight axis, per slant", () => {
    const { files, styles } = familyStyles(parseMetadata(VARIABLE))
    expect(files).toEqual(["LibreBaskerville[wght].ttf", "LibreBaskerville-Italic[wght].ttf"])
    expect(styles).toEqual([
      [400, 0, 0],
      [500, 0, 0],
      [600, 0, 0],
      [700, 0, 0],
      [400, 1, 1],
      [500, 1, 1],
      [600, 1, 1],
      [700, 1, 1],
    ])
  })

  it("keeps a static font's own styles", () => {
    expect(familyStyles(parseMetadata(STATIC)).styles).toEqual([[400, 0, 0]])
  })
})
