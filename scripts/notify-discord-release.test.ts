import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { buildMessage, cleanItem, DISCORD_LIMIT, parseNotes } from "./notify-discord-release.mjs"

const template = readFileSync(new URL("./discord-template.md", import.meta.url), "utf8")

const NOTES = `## [0.3.39](https://github.com/open20-rpg/open20-battlemaps/compare/v0.3.38...v0.3.39) (2026-11-18)

### Features

* herramienta Reemplazar Assets para los assets faltantes del mapa ([a39f4fd](https://github.com/open20-rpg/open20-battlemaps/commit/a39f4fd2ff070267b9c832277db21f9ee0a13356))
* **material:** add Move to Front ([1202b37](https://github.com/open20-rpg/open20-battlemaps/commit/1202b37ae8d5d026e7e07afc30ae4dbd79197620))

### Bug Fixes

* los portales se dibujan encima de las paredes, closes [#12](https://github.com/open20-rpg/open20-battlemaps/issues/12) ([27c05f7](https://github.com/open20-rpg/open20-battlemaps/commit/27c05f7bc0de6becb5eecb8cf9703bbfe4ce8632))
`

describe("notify-discord-release", () => {
  it("drops commit links, scopes and issue refs, and capitalizes", () => {
    expect(
      cleanItem("**material:** add Move to Front ([1202b37](https://example.com/commit/1202b37))"),
    ).toBe("Add Move to Front")
  })

  it("names the sections in Spanish", () => {
    expect(parseNotes(NOTES)).toEqual([
      {
        title: "Novedades",
        items: [
          "Herramienta Reemplazar Assets para los assets faltantes del mapa",
          "Add Move to Front",
        ],
      },
      { title: "Correcciones", items: ["Los portales se dibujan encima de las paredes"] },
    ])
  })

  it("joins multi-line breaking changes and drops duplicates", () => {
    const notes =
      "### ⚠ BREAKING CHANGES\n\n* maps no longer open\non Android.\n* maps no longer open\non Android.\n"
    expect(parseNotes(notes)).toEqual([
      { title: "⚠️ Cambios importantes", items: ["Maps no longer open on Android."] },
    ])
  })

  it("renders the template", () => {
    const message = buildMessage(template, "v0.3.39", NOTES)
    expect(message).toContain("# ¡Nueva versión v0.3.39 de Open20 Battle Maps!")
    expect(message).toContain("**Novedades**\n- Herramienta Reemplazar Assets")
    expect(message).toContain("https://open20.app/battle-maps")
    expect(message).toContain("/releases/tag/v0.3.39")
    expect(message).not.toContain("commit/")
  })

  it("fits long notes in Discord's limit and counts what was left out", () => {
    const items = Array.from({ length: 200 }, (_, i) => `* change number ${i} with some text`)
    const message = buildMessage(template, "v1.0.0", `### Features\n\n${items.join("\n")}\n`)
    expect(message.length).toBeLessThanOrEqual(DISCORD_LIMIT)
    const shown = message.split("\n").filter((l) => l.startsWith("- ")).length
    expect(message).toContain(`…y ${200 - shown} cambios más.`)
    expect(message).toContain("/releases/tag/v1.0.0")
  })
})
