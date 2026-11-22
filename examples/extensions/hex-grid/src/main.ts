import { defineExtension, type Primitive, type Vec2 } from "@open20/battlemaps-sdk"
import { regularPolygon } from "@open20/battlemaps-sdk/geometry"

/** Hex size (center to corner) in tiles: pointy-top hexes one tile wide. */
export const SIZE = 1 / Math.sqrt(3)

/** Axial coordinates (q, r) of the hex holding `p`. */
export function toAxial(p: Vec2): { q: number; r: number } {
  const q = ((Math.sqrt(3) / 3) * p.x - p.y / 3) / SIZE
  const r = ((2 / 3) * p.y) / SIZE
  // Cube rounding.
  let rx = Math.round(q)
  let rz = Math.round(r)
  const ry = Math.round(-q - r)
  const dx = Math.abs(rx - q)
  const dy = Math.abs(ry - (-q - r))
  const dz = Math.abs(rz - r)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy <= dz) rz = -rx - ry
  return { q: rx, r: rz }
}

export function fromAxial(q: number, r: number): Vec2 {
  return { x: SIZE * Math.sqrt(3) * (q + r / 2), y: SIZE * 1.5 * r }
}

export const hexDistance = (a: Vec2, b: Vec2): number => {
  const p = toAxial(a)
  const q = toAxial(b)
  return (Math.abs(p.q - q.q) + Math.abs(p.q + p.r - q.q - q.r) + Math.abs(p.r - q.r)) / 2
}

/** Outlines of every hex over a `w` × `h` map. */
export function hexLines(w: number, h: number, color = "#000000"): Primitive[] {
  const out: Primitive[] = []
  const rows = Math.ceil(h / (SIZE * 1.5)) + 1
  for (let r = 0; r <= rows; r++) {
    const qStart = -Math.ceil(r / 2) - 1
    for (let q = qStart; fromAxial(q, r).x <= w + 1; q++) {
      const c = fromAxial(q, r)
      out.push({ type: "path", points: regularPolygon(c, SIZE, 6, 30), closed: true, stroke: color, strokeWidth: 0.02, strokeAlpha: 0.5 })
    }
  }
  return out
}

export default defineExtension({
  async activate(ctx) {
    await ctx.render.gridType({
      id: "hex",
      name: { es: "Hexágonos", en: "Hexes" },
      draw: (area) => hexLines(area.w, area.h),
      snap: (p) => {
        const { q, r } = toAxial(p)
        return fromAxial(q, r)
      },
      distance: hexDistance,
      label: (p) => {
        const { q, r } = toAxial(p)
        return `${String(q).padStart(2, "0")}${String(r).padStart(2, "0")}`
      },
    })
    // Wall corners are good snap points on any grid.
    await ctx.editor.snapProvider({
      id: "wall-corners",
      name: { es: "Esquinas de muros", en: "Wall corners" },
      points: async (p, reach) => {
        const walls = await ctx.map.query({ kinds: ["wall"], rect: { x: p.x - reach, y: p.y - reach, w: reach * 2, h: reach * 2 } })
        return walls.flatMap((w) => w.points ?? [])
      },
    })
    await ctx.render.layer({ id: "hex-marks", name: { es: "Marcas hex", en: "Hex marks" }, value: 650 })
    await ctx.services.provide({
      id: "hex",
      version: "1.0.0",
      methods: {
        toAxial: async (p: Vec2) => toAxial(p),
        fromAxial: async (q: number, r: number) => fromAxial(q, r),
        distance: async (a: Vec2, b: Vec2) => hexDistance(a, b),
      },
    })
    await ctx.ui.command({
      id: "use-hex",
      title: { es: "Usar grilla hexagonal", en: "Use hex grid" },
      icon: "LuHexagon",
      run: async () => {
        await ctx.map.apply([{ op: "setGrid", grid: { kind: "ext:open20.hex-grid/hex", unit: "km", cellDistance: 10 } }], { label: "Grilla hex" })
        await ctx.editor.setView("grid", true)
      },
    })
    const showCoords = async (on: boolean) => {
      if (!on) return ctx.render.clearOverlay("coords")
      const map = await ctx.map.get()
      if (!map) return
      const labels: Primitive[] = []
      for (let r = 0; r * SIZE * 1.5 <= map.height; r += 2)
        for (let q = -Math.ceil(r / 2); fromAxial(q, r).x <= map.width; q += 2) {
          const c = fromAxial(q, r)
          labels.push({ type: "text", text: `${q},${r}`, position: c, size: 0.2, align: "center", color: "#ffffff" })
        }
      await ctx.render.setOverlay("coords", labels)
    }
    await ctx.ui.viewToggle({ id: "coords", name: { es: "Coordenadas hex", en: "Hex coordinates" }, icon: "LuHexagon", default: false, onChange: showCoords })
    // The hex under the pointer, in the status bar.
    ctx.editor.onPointer((p) => {
      if (!p) return
      const { q, r } = toAxial(p)
      void ctx.ui.setStatus("hex", `Hex ${q},${r}`)
    })
  },
})
