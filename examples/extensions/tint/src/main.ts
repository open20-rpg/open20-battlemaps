import { defineExtension } from "@open20/battlemaps-sdk"

/**
 * Tints: a "Tint" property on objects (saved as this extension's data on
 * each one), a style rule that paints them with it, a style function that
 * dims locked ones, and actions to tint or select what's tinted.
 */
export default defineExtension({
  async activate(ctx) {
    const kinds = ["object", "scatter", "portal"] as const
    await ctx.tools.properties({
      kinds: [...kinds],
      properties: [
        {
          spec: {
            kind: "color",
            key: "tint",
            label: { es: "Tinte", en: "Tint" },
            default: "#ffffff",
          },
          target: { data: "tint" },
        },
        {
          spec: {
            kind: "slider",
            key: "alpha",
            label: { es: "Opacidad", en: "Opacity" },
            default: 1,
            min: 0.1,
            max: 1,
            step: 0.05,
          },
          target: { data: "alpha" },
        },
      ],
    })
    // Data-driven: each entity's own data.tint; nothing runs per frame.
    await ctx.render.styleRule({
      id: "tinted",
      match: { kinds: [...kinds], data: { key: "tint" } },
      style: { tint: { data: "tint" }, alpha: { data: "alpha", default: 1 } },
    })
    await ctx.render.styleFunction({
      id: "locked-dim",
      match: { kinds: [...kinds] },
      style: (e) => (e.locked ? { saturation: 0.3 } : null),
    })
    const tintSelection = async (color: string) => {
      const { selection } = await ctx.editor.get()
      if (!selection.length)
        return ctx.ui.notify({ message: "Seleccioná algo primero", tone: "warning" })
      const entities = await ctx.map.query({ ids: selection, level: "all" })
      await ctx.map.apply(
        entities.map((e) => ({
          op: "setData" as const,
          id: e.id,
          data: { ...e.data, tint: color },
        })),
        { label: "Teñir" },
      )
      return null
    }
    await ctx.ui.command({
      id: "tint-red",
      title: { es: "Teñir de rojo", en: "Tint red" },
      icon: "LuPalette",
      shortcut: "Ctrl+Alt+T",
      run: async () => void (await tintSelection("#a70909")),
    })
    await ctx.ui.contextMenu({
      id: "clear-tint",
      title: { es: "Quitar tinte", en: "Clear tint" },
      match: { data: { key: "tint" } },
      run: async ({ entities }) => {
        await ctx.map.apply(entities.map((e) => ({ op: "setData" as const, id: e.id, data: null })))
      },
    })
    await ctx.tools.selectionMode({
      id: "tinted",
      name: { es: "Lo teñido", en: "Tinted" },
      select: async () => (await ctx.map.query({ hasData: "tint" })).map((e) => e.id),
    })
  },
})
