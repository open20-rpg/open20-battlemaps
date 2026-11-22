import { afterEach, describe, expect, it } from "vitest"
import { useMapStore } from "../../../src/stores/mapStore"
import { useExtensionsStore } from "../../../src/stores/extensionsStore"
import { dropFile, loadImported } from "../../../src/features/extensions/actions"
import { setDocumentHooks } from "../../../src/features/map/io"
import { contribution, startExample } from "../testing"
import manifest from "./manifest.json"
import vtt, { fromUvtt, toUvtt, type Uvtt } from "./src/main"

let stop: (() => void) | undefined
afterEach(() => stop?.())
const enc = new TextEncoder()
const dec = new TextDecoder()

describe("VTT export", () => {
  it("round-trips walls, doors and lights, leaving DM-only things out for players", () => {
    const wall = { id: "w", kind: "wall", points: [{ x: 0, y: 0 }, { x: 3, y: 0 }], data: {} }
    const secret = { id: "s", kind: "portal", position: { x: 1, y: 0 }, data: { dmOnly: true } }
    const u = toUvtt({ width: 10, height: 8 }, [wall, secret] as never, "", true)
    expect(u.line_of_sight).toHaveLength(1)
    expect(u.portals).toHaveLength(0)
    expect(toUvtt({ width: 10, height: 8 }, [wall, secret] as never, "", false).portals).toHaveLength(1)
    expect(fromUvtt(u).entities).toHaveLength(1)
  })

  it("exports with the map's image and imports as a new map", async () => {
    const { h, ctx } = await startExample(vtt, manifest)
    stop = () => h.stop()
    await ctx.map.add([{ kind: "wall", position: { x: 0, y: 0 }, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }])
    const file = await contribution("exportFormat", "uvtt").export({ profile: null, options: { players: true } })
    const u = JSON.parse(dec.decode(file.bytes)) as Uvtt
    expect(u.image.length).toBeGreaterThan(0)
    expect(u.line_of_sight).toHaveLength(1)
    const imported = await contribution("importFormat", "uvtt").import(file)
    loadImported("open20.vtt-export", imported.map)
    expect(useMapStore.getState().map!.entities.filter((e) => e.toolId === "wall")).toHaveLength(1)
  })

  it("warns before saving a map without walls, signs exports and translates mod notes", async () => {
    const { h } = await startExample(vtt, manifest)
    stop = () => h.stop()
    expect(await h.host.documentHooks("beforeSave")).toEqual(["El mapa no tiene muros: el VTT no tendrá línea de visión"])
    const signed = await contribution("exportHook", "signature").process({ name: "mapa.png", bytes: new Uint8Array() }, {})
    expect(signed.name).toBe("mapa-firmado.png")
    const t = await contribution("dungeondraftTranslator", "notes").translate({ mod_notes: [{ text: "Trampa", x: 2, y: 3 }] }, { width: 1, height: 1, levels: [], entities: [] })
    expect(t.entities).toEqual([{ kind: "text", position: { x: 2, y: 3 }, text: "Trampa" }])
    expect(contribution("exportProfile", "players").hide).toEqual([{ data: { key: "dmOnly" } }])
    setDocumentHooks(null)
  })

  it("places tokens from a dropped file where they fall", async () => {
    const { h } = await startExample(vtt, manifest)
    stop = () => h.stop()
    const bytes = enc.encode(JSON.stringify([{ name: "Goblin", asset: "p|goblin.png" }, { name: "Orco", asset: "p|orc.png" }]))
    expect(await dropFile({ name: "grupo.tokens", bytes }, { x: 5, y: 5 })).toBe(true)
    expect(useMapStore.getState().map!.entities.map((e) => e.position)).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }])
    const opened = await contribution("fileHandler", "tokens").open!({ name: "x.dd2vtt", bytes: enc.encode(JSON.stringify(toUvtt({ width: 4, height: 4 }, [], "", true))) })
    expect(opened.map.width).toBe(4)
  })

  it("asks for the folder and the clipboard only when used", async () => {
    const { h } = await startExample(vtt, manifest)
    stop = () => h.stop()
    const running = contribution("command", "export-both").run()
    await h.answer(true)
    await running
    expect([...h.services.folder.keys()].sort()).toEqual(["dm.dd2vtt", "jugadores.dd2vtt"])
    const copying = contribution("command", "copy-walls").run()
    await h.answer(true)
    await copying
    expect(h.services.clipboard).toBe("[]")
    h.services.pickResult = [{ name: "a.dd2vtt", bytes: enc.encode(JSON.stringify(toUvtt({ width: 4, height: 4 }, [], "", true))) }]
    await contribution("command", "import-file").run()
    expect(h.services.saved.map((f) => f.name)).toEqual(["copia.dd2vtt"])
    expect(useExtensionsStore.getState().installed["open20.vtt-export"].granted).toEqual(
      expect.arrayContaining(["folder", "clipboard"]),
    )
  })
})
