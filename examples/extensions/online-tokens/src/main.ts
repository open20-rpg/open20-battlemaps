import { defineExtension, type AssetInfo, type Vec2 } from "@open20/battlemaps-sdk"

const API = "https://api.open20.app/tokens"

interface RemoteToken {
  id: string
  name: string
  image: string
}

const parse = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as unknown

export default defineExtension({
  async activate(ctx) {
    let limit = Number(ctx.settings.get().limit ?? 40)
    ctx.settings.onChange((s) => void (limit = Number(s.limit ?? 40)))

    const searchRemote = async (query: string): Promise<AssetInfo[]> => {
      const res = await ctx.net.fetch(`${API}?q=${encodeURIComponent(query)}&limit=${limit}`, { headers: { accept: "application/json" } })
      const list = (parse(res.body) as { tokens?: RemoteToken[] }).tokens ?? []
      return list.map((t) => ({ id: `remote:${t.id}`, name: t.name, category: "objects", pack: "online", tags: ["token"], colorable: false }))
    }
    await ctx.library.tab({
      id: "online",
      title: { es: "En línea", en: "Online" },
      category: "objects",
      search: async (q) => {
        const local = await ctx.library.search({ ...q, tags: ["token"], limit: 20 })
        return [...local, ...(await searchRemote(q.query ?? "").catch(() => []))]
      },
    })
    await ctx.packs.metadata({ id: "token", fields: [{ kind: "number", key: "size", label: { es: "Tamaño (casillas)", en: "Size (tiles)" }, default: 1, min: 1, max: 6 }] })

    await ctx.ui.command({
      id: "save-tokens",
      title: { es: "Guardar tokens en un pack", en: "Save tokens in a pack" },
      run: async () => {
        const last = await ctx.storage.get<{ query: string }>("lastSearch")
        const query = last?.query ?? "goblin"
        const found = await searchRemote(query)
        await ctx.storage.set("lastSearch", { query, count: found.length })
        // Remember a bigger page next time when there were many.
        if (found.length >= limit) await ctx.settings.set("limit", Math.min(200, limit * 2))
        const packs = await ctx.library.packs()
        const pack = packs.find((p) => p.editable)?.id ?? (await ctx.packs.create("Tokens en línea", "Open20"))
        const files = await Promise.all(
          found.slice(0, 5).map(async (t) => {
            const img = await ctx.net.fetch(`${API}/${t.id.slice(7)}.png`)
            return { name: `${t.name}.png`, bytes: img.body, mime: "image/png" }
          }),
        )
        const ids = await ctx.packs.importImages(pack, files, "objects")
        await Promise.all(ids.map((id) => ctx.packs.setTags(id, ["token", "online"])))
        if (ids[0]) await ctx.packs.setMetadata(ids[0], { size: 1 })
        const asset = ids[0] ? await ctx.library.asset(ids[0]) : null
        const image = ids[0] ? await ctx.library.image(ids[0], 64) : null
        await ctx.ui.notify(`${ctx.t("found", { n: found.length })} · ${ctx.t("saved", { pack })} · ${asset?.name ?? ""} ${image?.bytes.length ?? 0}b`)
      },
    })
    // Live table: positions of tokens sent to the players' server (asked when used).
    await ctx.ui.command({
      id: "live",
      title: { es: "Sincronizar mesa en vivo", en: "Sync live table" },
      run: async () => {
        if (!(await ctx.requestPermission("network:live.open20.app"))) return
        const socket = await ctx.net.socket("wss://live.open20.app/table", (data) => ctx.log.info("table:", data))
        const hex = ctx.services.use<{ toAxial(p: Vec2): Promise<{ q: number; r: number }> }>("open20.hex-grid/hex")
        const cell = await hex.toAxial({ x: 1, y: 1 })
        await socket.send(JSON.stringify({ cell }))
        const d = await ctx.services.call<number>("open20.hex-grid/hex", "distance", { x: 0, y: 0 }, { x: 2, y: 0 })
        await ctx.services.emit("table-synced", { distance: d })
        await socket.close()
      },
    })
    ctx.services.onEvent((e) => ctx.log.info("event from", e.from, e.name))
    await ctx.ui.command({
      id: "about",
      title: { es: "Sitio de los tokens", en: "Tokens website" },
      run: async () => {
        const prefs = await ctx.app.preferences()
        await ctx.fonts.load("Cinzel")
        await ctx.app.openUrl(`https://open20.app/tokens?lang=${prefs.language}`)
        await ctx.storage.delete("lastSearch")
        ctx.log.debug("keys", await ctx.storage.keys())
      },
    })
  },
})
