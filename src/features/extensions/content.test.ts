import { describe, expect, it } from "vitest"
import { cleanTranslations } from "./content"

describe("cleanTranslations", () => {
  it("keeps only strings, nested", () => {
    expect(cleanTranslations({ a: "x", b: { c: "y", d: 3, e: [1] }, f: null })).toEqual({
      a: "x",
      b: { c: "y", e: {} },
    })
    expect(cleanTranslations("nope")).toEqual({})
  })
})
