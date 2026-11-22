import {
  defineExtension,
  type Entity,
  type ExtensionContext,
  type FileData,
  type MapDocumentData,
  type NewEntity,
} from "@open20/battlemaps-sdk"

/** Universal VTT, the subset that matters: size, walls, doors, lights and the image. */
export interface Uvtt {
  format: number
  resolution: { map_origin: { x: number; y: number }; map_size: { x: number; y: number }; pixels_per_grid: number }
  line_of_sight: { x: number; y: number }[][]
  portals: { position: { x: number; y: number }; closed: boolean }[]
  lights: { position: { x: number; y: number }; range: number; color: string }[]
  image: string
}

const toBase64 = (bytes: Uint8Array) => {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** A map's entities as Universal VTT (players' version leaves DM-only things out). */
export function toUvtt(size: { width: number; height: number }, entities: Entity[], image: string, players: boolean): Uvtt {
  const visible = players ? entities.filter((e) => !e.data.dmOnly) : entities
  return {
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: size.width, y: size.height }, pixels_per_grid: 64 },
    line_of_sight: visible.filter((e) => e.kind === "wall" && e.points).map((e) => e.points!.map((p) => ({ x: p.x, y: p.y }))),
    portals: visible.filter((e) => e.kind === "portal").map((e) => ({ position: e.position, closed: true })),
    lights: visible.filter((e) => e.kind === "light").map((e) => ({ position: e.position, range: Number(e.params.range ?? 4), color: String(e.params.color ?? "#ffffff") })),
    image,
  }
}

export function fromUvtt(u: Uvtt): MapDocumentData {
  const entities: NewEntity[] = [
    ...u.line_of_sight.map((pts) => ({ kind: "wall" as const, position: pts[0], points: pts })),
    ...u.portals.map((p) => ({ kind: "portal" as const, position: p.position })),
    ...u.lights.map((l) => ({ kind: "light" as const, position: l.position, params: { range: l.range, color: l.color } })),
  ]
  return { width: u.resolution.map_size.x, height: u.resolution.map_size.y, levels: [{ id: "level-1", name: "" }], entities }
}

const json = (file: FileData) => JSON.parse(new TextDecoder().decode(file.bytes)) as unknown

async function exportUvtt(ctx: ExtensionContext, players: boolean): Promise<FileData> {
  const map = await ctx.map.get()
  if (!map) throw new Error("no map")
  const image = await ctx.render.toImage({ format: "png", pxPerTile: 64 })
  const uvtt = toUvtt(map, await ctx.map.query({ level: "all" }), toBase64(image.bytes), players)
  return { name: "mapa.dd2vtt", bytes: new TextEncoder().encode(JSON.stringify(uvtt)), mime: "application/json" }
}

export default defineExtension({
  async activate(ctx) {
    await ctx.files.exportFormat({
      id: "uvtt",
      name: "Universal VTT",
      extension: "dd2vtt",
      options: [{ kind: "switch", key: "players", label: { es: "Versión jugadores", en: "Players' version" }, default: true }],
      export: ({ options }) => exportUvtt(ctx, options.players !== false),
    })
    await ctx.files.importFormat({
      id: "uvtt",
      name: "Universal VTT",
      extensions: ["dd2vtt", "uvtt"],
      import: (file) => ({ map: fromUvtt(json(file) as Uvtt), warnings: ["La imagen de fondo no se importa"] }),
    })
    await ctx.files.exportProfile({ id: "players", name: { es: "Jugadores", en: "Players" }, hide: [{ data: { key: "dmOnly" } }] })
    await ctx.files.exportHook({
      id: "signature",
      options: [{ kind: "text", key: "author", label: { es: "Autor", en: "Author" }, default: "" }],
      process: (image) => ({ ...image, name: image.name.replace(/\.png$/, "-firmado.png") }),
    })
    await ctx.files.documentHook({
      id: "walls-check",
      beforeSave: async () => ((await ctx.map.query({ kinds: ["wall"], limit: 1 })).length ? [] : ["El mapa no tiene muros: el VTT no tendrá línea de visión"]),
      afterOpen: async () => [],
    })
    await ctx.files.handler({
      id: "tokens",
      extensions: ["dd2vtt", "tokens"],
      open: (file) => ({ map: fromUvtt(json(file) as Uvtt), warnings: [] }),
      drop: (file, at) => {
        const tokens = json(file) as { name: string; asset: string }[]
        return [{ op: "add", entities: tokens.map((t, i) => ({ kind: "object" as const, position: { x: at.x + i, y: at.y }, asset: t.asset, data: { token: t.name } })) }]
      },
    })
    // Dungeondraft mods kept notes in `mod_notes`: they become text on the map.
    await ctx.files.dungeondraftTranslator({
      id: "notes",
      handles: ["mod_notes"],
      translate: (data) => {
        const notes = (data as { mod_notes?: { text: string; x: number; y: number }[] }).mod_notes ?? []
        return { entities: notes.map((n) => ({ kind: "text" as const, position: { x: n.x, y: n.y }, text: n.text })), warnings: [] }
      },
    })
    await ctx.ui.command({
      id: "export-both",
      title: { es: "Exportar jugadores y DM a una carpeta", en: "Export players' and DM's to a folder" },
      run: async () => {
        if (!(await ctx.requestPermission("folder"))) return
        if (!(await ctx.folder.request())) return
        for (const players of [true, false]) {
          const file = await exportUvtt(ctx, players)
          await ctx.folder.write(players ? "jugadores.dd2vtt" : "dm.dd2vtt", file.bytes)
        }
        const files = await ctx.folder.list()
        const check = await ctx.folder.read(files[0].name)
        await ctx.folder.release()
        await ctx.ui.notify(`${files.length} archivos (${check.length} bytes el primero)`)
      },
    })
    await ctx.ui.command({
      id: "copy-walls",
      title: { es: "Copiar muros como JSON", en: "Copy walls as JSON" },
      run: async () => {
        if (!(await ctx.requestPermission("clipboard"))) return
        const map = (await ctx.map.get())!
        await ctx.clipboard.writeText(JSON.stringify(toUvtt(map, await ctx.map.query({ kinds: ["wall"] }), "", true).line_of_sight))
        await ctx.clipboard.writeImage(await ctx.render.toImage({ format: "png" }))
        await ctx.ui.notify(`Copiado: ${(await ctx.clipboard.readText()).length} caracteres`)
      },
    })
    await ctx.ui.command({
      id: "import-file",
      title: { es: "Importar UVTT desde archivo", en: "Import UVTT from file" },
      run: async () => {
        const [file] = await ctx.files.pick({ extensions: ["dd2vtt"] })
        if (!file) return
        const data = fromUvtt(json(file) as Uvtt)
        await ctx.map.add(data.entities)
        await ctx.files.save({ name: "copia.dd2vtt", bytes: file.bytes })
      },
    })
  },
})
