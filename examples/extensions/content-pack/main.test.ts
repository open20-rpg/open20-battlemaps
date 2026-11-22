import { afterEach, describe, expect, it } from "vitest"
import i18n from "../../../src/i18n"
import { useExtensionsStore } from "../../../src/stores/extensionsStore"
import { createHarness, type Harness } from "../../../src/features/extensions/testHarness"
import { dataContributions, ExtensionManager } from "../../../src/features/extensions/manager"
import { applyLanguagePack } from "../../../src/features/extensions/content"
import { createRenderBridge } from "../../../src/features/extensions/renderBridge"

// Every file of the pack, as it ships (text files raw, the image inlined).
const texts = import.meta.glob(["./**/*.{json,glsl,otbm}", "!./**/*.test.ts"], {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>
const images = import.meta.glob(["./assets/*.png", "./fonts/*.ttf"], {
  eager: true,
  query: "?inline",
  import: "default",
}) as Record<string, string>

function packFiles(): Map<string, Uint8Array> {
  const enc = new TextEncoder()
  const files = new Map<string, Uint8Array>()
  for (const [p, text] of Object.entries(texts)) files.set(p.slice(2), enc.encode(text))
  for (const [p, url] of Object.entries(images))
    files.set(
      p.slice(2),
      Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0)),
    )
  return files
}

let h: Harness
afterEach(() => h?.stop())

describe("content pack (data only)", () => {
  it("installs without permissions or code, and brings its content", async () => {
    h = createHarness()
    const manager = new ExtensionManager(h.host)
    const check = manager.prepareFiles(packFiles())
    if (!check.ok) throw new Error(check.errors.join("\n"))
    expect(check.prepared.newPermissions).toEqual([])
    await manager.install(check.prepared)
    expect(useExtensionsStore.getState().status["open20.content-pack"].status).toBe("active")
    const data = dataContributions.get("open20.content-pack")!
    expect(data.palettes[0].colors).toHaveLength(4)
    expect(data.prefabs[0].data).toHaveLength(2)
    expect(data.keymaps[0].data).toEqual({ undo: ["Ctrl+Z"], redo: ["Ctrl+Y"], save: ["Ctrl+S"] })
    expect(data.toolPresets[0].tool).toBe("scatter")
    expect(data.fonts).toEqual([
      { family: "Open20 Runas", path: "fonts/open20-runas.ttf", license: "CC0-1.0" },
    ])
    const kinds = useExtensionsStore.getState().contributions.map((c) => c.contribution.type)
    expect(kinds).toEqual(expect.arrayContaining(["newMapPreset", "shader"]))
  })

  it("adds a language the app can switch to", async () => {
    h = createHarness()
    const manager = new ExtensionManager(h.host)
    const check = manager.prepareFiles(packFiles())
    if (!check.ok) throw new Error("invalid")
    await manager.install(check.prepared)
    const pt = dataContributions.get("open20.content-pack")!.languagePacks[0]
    applyLanguagePack(pt.lang!, pt.data)
    expect(i18n.t("menu.extensions")).toBe("Extensões")
    await i18n.changeLanguage("es")
  })

  it("serves its bundled images and ships a valid template", async () => {
    h = createHarness()
    const manager = new ExtensionManager(h.host)
    const check = manager.prepareFiles(packFiles())
    if (!check.ok) throw new Error("invalid")
    await manager.install(check.prepared)
    const bridge = createRenderBridge(h.services)
    expect(bridge.imageUrl("ext:open20.content-pack/dot.png")).toBeNull()
    await h.flush()
    expect(h.services.files.get("open20.content-pack")?.has("assets/dot.png")).toBe(true)
    expect(bridge.imageUrl("ext:open20.content-pack/dot.png")).toMatch(/^blob:/)
    // The template is a regular .otbm (opened by openMapTemplate in the app).
    expect(dataContributions.get("open20.content-pack")!.templates[0].path).toBe(
      "templates/capacidades.otbm",
    )
    expect(JSON.parse(texts["./templates/capacidades.otbm"])).toHaveProperty("map")
  })
})
