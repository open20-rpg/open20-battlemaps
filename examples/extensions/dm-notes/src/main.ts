import { defineExtension, type ExtensionContext, type UiNode } from "@open20/battlemaps-sdk"

/** The notes panel: one row per note, a field to write a new one. */
export async function notesPanel(ctx: ExtensionContext, draft: { text: string }): Promise<UiNode> {
  const notes = await ctx.map.query({ hasData: "note", level: "all" })
  return {
    type: "column",
    children: [
      { type: "heading", text: "Notas" },
      { type: "list", items: notes.map((n) => ({ id: n.id, label: String(n.data.note) })), onSelect: (id) => void ctx.editor.select([id]) },
      { type: "field", spec: { kind: "text", key: "note", label: "Nueva nota", default: "" }, value: draft.text, onChange: (v) => void (draft.text = String(v)) },
      {
        type: "button",
        label: "Anotar la selección",
        variant: "solid",
        onClick: async () => {
          const { selection } = await ctx.editor.get()
          await ctx.map.apply(selection.map((id) => ({ op: "setData" as const, id, data: { note: draft.text, dmOnly: true } })))
          await ctx.ui.updatePanel("notes", await notesPanel(ctx, draft))
        },
      },
      { type: "divider" },
      { type: "text", text: `${notes.length} notas`, tone: "muted" },
    ],
  }
}

export default defineExtension({
  async activate(ctx) {
    const draft = { text: "" }
    await ctx.ui.panel({ id: "notes", title: { es: "Notas del DM", en: "DM notes" }, icon: "LuPencil", render: () => notesPanel(ctx, draft) })
    await ctx.ui.iframePanel({
      id: "summary",
      title: { es: "Resumen", en: "Summary" },
      html: "panel/index.html",
      onMessage: async (m) => {
        if ((m as { refresh?: boolean }).refresh)
          await ctx.ui.postToFrame("summary", { notes: (await ctx.map.query({ hasData: "note", level: "all" })).length })
      },
    })
    await ctx.views.register({ id: "players", title: { es: "Vista de jugadores", en: "Players' view" }, hide: [{ data: { key: "dmOnly" } }], fog: true })
    await ctx.ui.command({
      id: "reveal",
      title: { es: "Revelar la selección a los jugadores", en: "Reveal selection to players" },
      run: async () => {
        const { selection } = await ctx.editor.get()
        const rooms = await ctx.map.query({ ids: selection })
        await ctx.views.open("players")
        for (const r of rooms) if (r.points) await ctx.views.reveal("players", r.points)
      },
    })
    await ctx.ui.command({ id: "close-view", title: { es: "Cerrar vista de jugadores", en: "Close players' view" }, run: () => ctx.views.close("players") })
    await ctx.ui.statusItem({ id: "count", text: "Notas: 0", tooltip: "Notas del DM en el mapa", onClick: () => ctx.ui.openPanel("notes") })
    ctx.map.onChange(async () => {
      const n = (await ctx.map.query({ hasData: "note", level: "all" })).length
      await ctx.ui.setStatus("count", `Notas: ${n}`)
    })
    await ctx.ui.tour({
      id: "welcome",
      title: { es: "Notas del DM", en: "DM notes" },
      steps: [
        { target: "canvas", text: { es: "Seleccioná una habitación.", en: "Select a room." } },
        { target: "panel:notes", text: { es: "Escribí la nota y anotala.", en: "Write the note and add it." } },
        { target: "statusBar", text: { es: "Acá ves cuántas hay.", en: "See how many there are here." } },
      ],
    })
    await ctx.stats.register({
      id: "notes",
      title: { es: "Notas", en: "Notes" },
      compute: async () => {
        const notes = await ctx.map.query({ hasData: "note", level: "all" })
        return [
          { label: "Notas", value: String(notes.length) },
          { label: "Secretas", value: String(notes.filter((n) => n.data.dmOnly).length) },
        ]
      },
    })
    // A note must say something (if the setting asks for it).
    await ctx.map.addValidator((_change, entities) =>
      ctx.settings.get().warnEmpty !== false && entities.some((e) => e.data.note === "") ? { veto: "Una nota no puede estar vacía" } : null,
    )
    await ctx.ui.command({
      id: "clear-notes",
      title: { es: "Borrar notas…", en: "Clear notes…" },
      run: async () => {
        const which = await ctx.ui.choose("¿Qué notas?", [{ id: "all", label: "Todas" }, { id: "secret", label: "Solo las secretas" }])
        if (!which) return
        const reason = await ctx.ui.prompt("Motivo", "¿Por qué las borrás?", "limpieza")
        if (!(await ctx.ui.confirm("Borrar notas", `Se borran (${reason}).`, true))) return
        const notes = await ctx.map.query({ hasData: "note", level: "all" })
        await ctx.ui.withProgress("Borrando notas", async (report) => {
          const targets = notes.filter((n) => which === "all" || n.data.dmOnly)
          await ctx.map.apply(targets.map((n) => ({ op: "setData" as const, id: n.id, data: null })))
          report(1, `${targets.length} borradas`)
        })
        const theme = await ctx.ui.theme()
        ctx.log.info("notes cleared", theme.mode)
        await ctx.ui.closePanel("notes")
        await ctx.ui.startTour("welcome")
      },
    })
  },
})
