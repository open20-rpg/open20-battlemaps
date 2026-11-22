import {
  defineExtension,
  type Primitive,
  type ToolContext,
  type Vec2,
} from "@open20/battlemaps-sdk"
import { poissonDisk } from "@open20/battlemaps-sdk/random"
import { resample, smooth } from "@open20/battlemaps-sdk/geometry"
import { simplex2 } from "@open20/battlemaps-sdk/random"

const STAMP_ICON =
  '<svg viewBox="0 0 24 24"><path d="M5 22h14M12 2v10M7 12h10l2 6H5z" stroke="currentColor" fill="none" stroke-width="2"/></svg>'

/** Posts every tile along a fence line. */
export const posts = (points: Vec2[]) => resample(points, 1)

export default defineExtension({
  async activate(ctx) {
    const asset = (t: ToolContext) =>
      typeof t.params.asset === "string"
        ? t.params.asset
        : "open20.essentials|textures/objects/barrel.png"

    // Click: stamp the picked object where clicked.
    await ctx.tools.register({
      id: "stamp",
      name: { es: "Sello", en: "Stamp" },
      icon: STAMP_ICON,
      group: "objects",
      gesture: "click",
      help: {
        es: "Hacé clic para estampar el objeto elegido.",
        en: "Click to stamp the picked object.",
      },
      params: [
        {
          kind: "asset",
          key: "asset",
          label: { es: "Objeto", en: "Object" },
          default: null,
          category: "objects",
        },
        {
          kind: "range",
          key: "scale",
          label: { es: "Escala", en: "Scale" },
          default: [0.8, 1.2],
          min: 0.2,
          max: 3,
          step: 0.1,
        },
      ],
      onShape: async (t, s) => {
        const [lo, hi] = (t.params.scale as [number, number]) ?? [1, 1]
        await ctx.map.add([
          {
            kind: "object",
            position: s.points[0],
            asset: asset(t),
            scale: lo + Math.random() * (hi - lo),
          },
        ])
      },
    })
    // Polyline: a palisade (a wall drawn with this extension's style) plus posts.
    await ctx.tools.register({
      id: "palisade",
      name: { es: "Empalizada", en: "Palisade" },
      icon: "LuFence",
      group: "design",
      gesture: "polyline",
      onShape: async (_t, s) => {
        const ids = await ctx.map.add(
          [
            {
              kind: "wall",
              position: s.points[0],
              points: s.points,
              params: { extStyle: "open20.stamp-tools/palisade" },
            },
            ...posts(s.points).map((p) => ({
              kind: "object" as const,
              position: p,
              asset: "open20.essentials|textures/objects/post.png",
            })),
          ],
          { label: "Empalizada" },
        )
        await ctx.map.apply([
          { op: "group", ids },
          { op: "attach", ids: ids.slice(1), parent: ids[0] },
        ])
      },
    })
    // Brush: a trail of footprints spread along the stroke.
    await ctx.tools.register({
      id: "trail",
      name: { es: "Sendero", en: "Trail" },
      icon: "LuBrush",
      group: "terrain",
      gesture: "brush",
      params: [
        {
          kind: "slider",
          key: "size",
          label: { es: "Ancho", en: "Width" },
          default: 0.6,
          min: 0.2,
          max: 3,
          step: 0.1,
        },
      ],
      onShape: async (_t, s) => {
        await ctx.map.add([{ kind: "path", position: s.points[0], points: smooth(s.points, 2) }])
      },
    })
    // Rect: a quick room (floor + wall, linked like Build's).
    await ctx.tools.register({
      id: "room",
      name: { es: "Habitación rápida", en: "Quick room" },
      icon: "LuSquare",
      group: "ext:quick",
      gesture: "rect",
      onShape: async (_t, s) => {
        const ids = await ctx.map.add([
          { kind: "build", position: s.points[0], points: s.points, closed: true },
          { kind: "wall", position: s.points[0], points: s.points, closed: true },
        ])
        await ctx.map.apply([{ op: "link", ids }])
      },
    })
    // No gesture: raw pointer events, keys and a button; it draws its own draft.
    let start: Vec2 | null = null
    await ctx.tools.register({
      id: "ruler",
      name: { es: "Regla", en: "Ruler" },
      icon: "LuRuler",
      group: "ext:quick",
      gesture: "none",
      keys: ["Escape"],
      cursor: "crosshair",
      params: [
        {
          kind: "segmented",
          key: "unit",
          label: { es: "Unidad", en: "Unit" },
          default: "tiles",
          options: [
            { value: "tiles", label: { es: "Casillas", en: "Tiles" } },
            { value: "feet", label: { es: "Pies", en: "Feet" } },
          ],
        },
        { kind: "button", key: "clear", label: { es: "Borrar", en: "Clear" } },
      ],
      onActivate: () => ctx.editor.setCursor("crosshair"),
      onDeactivate: async () => {
        start = null
        await ctx.tools.setDraft([])
        await ctx.editor.setCursor(null)
      },
      onPointerDown: (_t, e) => void (start = e.snapped),
      onPointerMove: async (t, e) => {
        if (!start) return
        const d = Math.hypot(e.x - start.x, e.y - start.y) * (t.params.unit === "feet" ? 5 : 1)
        const line: Primitive[] = [
          {
            type: "path",
            points: [start, { x: e.x, y: e.y }],
            stroke: "#e0534e",
            strokeWidth: 0.05,
            dash: [0.2, 0.1],
          },
          { type: "text", text: d.toFixed(1), position: { x: e.x, y: e.y - 0.4 }, size: 0.35 },
        ]
        await ctx.tools.setDraft(line)
      },
      onPointerUp: () => void (start = null),
      onKey: async () => {
        start = null
        await ctx.tools.setDraft([])
      },
      onAction: async (_t, action) => {
        if (action === "clear") await ctx.tools.setDraft([])
      },
      onParamsChange: async (_t, patch) => {
        if ("unit" in patch) await ctx.tools.setDraft([])
      },
    })

    await ctx.tools.brushTip({
      id: "chalk",
      name: { es: "Tiza", en: "Chalk" },
      asset: "ext:open20.stamp-tools/chalk.png",
      dynamics: { size: [0.5, 1], opacity: [0.4, 1] },
      smoothing: 0.4,
    })
    await ctx.tools.scatterDistribution({
      id: "even",
      name: { es: "Pareja (Poisson)", en: "Even (Poisson)" },
      points: (area, density, seed) =>
        poissonDisk(area, Math.max(0.3, 1.5 / Math.max(density, 0.1)), seed),
    })
    await ctx.tools.wallStyle({
      id: "palisade",
      name: { es: "Empalizada", en: "Palisade" },
      render: (wall) =>
        resample(wall.points ?? [], 0.35).map((p) => ({
          type: "circle",
          center: p,
          radius: 0.16,
          fill: "#6b4a2b",
          stroke: "#3a2814",
          strokeWidth: 0.03,
        })),
    })
    await ctx.tools.pathStyle({
      id: "river",
      name: { es: "Río", en: "River" },
      render: (path) => [
        {
          type: "path",
          points: smooth(path.points ?? [], 3),
          stroke: "#3c78b4",
          strokeWidth: 0.6,
          strokeAlpha: 0.8,
        },
      ],
      route: (from, to) => smooth([from, { x: (from.x + to.x) / 2, y: from.y }, to], 2),
    })
    const noise = simplex2(3)
    await ctx.tools.terrainRule({
      id: "highlands",
      name: { es: "Tierras altas", en: "Highlands" },
      weights: (p, slots) => {
        const h = (noise(p.x / 12, p.y / 12) + 1) / 2
        return Array.from({ length: slots }, (_, i) =>
          Math.max(0, 1 - Math.abs(h * (slots - 1) - i)),
        )
      },
    })

    // Editor helpers: clone, pick, history and switching tools and levels.
    await ctx.ui.command({
      id: "clone",
      title: { es: "Clonar selección", en: "Clone selection" },
      run: async () => {
        const { selection } = await ctx.editor.get()
        if (!(await ctx.editor.copy(selection))) return
        await ctx.editor.select(await ctx.editor.paste({ offset: { x: 1, y: 1 } }))
      },
    })
    await ctx.ui.command({
      id: "pick",
      title: { es: "Elegir lo que está bajo el puntero", en: "Pick what's under the pointer" },
      run: async () => {
        const { pointer } = await ctx.editor.get()
        if (pointer) await ctx.editor.select(await ctx.map.hitTest(pointer))
      },
    })
    await ctx.ui.command({
      id: "step-back",
      title: { es: "Deshacer y rehacer", en: "Undo and redo" },
      run: async () => {
        const h = await ctx.map.history()
        if (h.canUndo) await ctx.map.undo()
        if ((await ctx.map.history()).canRedo) await ctx.map.redo()
      },
    })
    await ctx.ui.command({
      id: "stamp-big",
      title: { es: "Sello grande en el primer nivel", en: "Big stamp on the first level" },
      run: async () => {
        const map = await ctx.map.get()
        if (!map) return
        await ctx.editor.setLevel(map.levels[0].id)
        await ctx.editor.setTool("ext:open20.stamp-tools/stamp")
        await ctx.editor.setToolParams("ext:open20.stamp-tools/stamp", { scale: [2, 2.5] })
      },
    })

    // An editor macro using the map and editor APIs end to end.
    await ctx.ui.command({
      id: "tidy",
      title: { es: "Ordenar selección", en: "Tidy selection" },
      run: async () => {
        const { selection, activeLevel } = await ctx.editor.get()
        if (!selection.length || !activeLevel) return
        await ctx.map.apply(
          [
            { op: "transform", ids: selection, rotate: 0, flipX: false },
            { op: "reorder", ids: selection, mode: "front" },
            { op: "lock", ids: selection, locked: true },
          ],
          { label: "Ordenar" },
        )
        await ctx.editor.camera({ fit: selection })
      },
    })
  },
})
