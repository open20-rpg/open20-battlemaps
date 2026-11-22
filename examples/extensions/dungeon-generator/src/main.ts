import {
  defineExtension,
  type Entity,
  type MapOp,
  type NewEntity,
  type Rect,
} from "@open20/battlemaps-sdk"
import { rng } from "@open20/battlemaps-sdk/random"
import { rectPoints } from "@open20/battlemaps-sdk/geometry"

const TORCH = "open20.essentials|textures/objects/torch.png"

/** Rooms of a seeded dungeon in `area`: non-overlapping rectangles joined by corridors. */
export function layout(
  area: Rect,
  rooms: number,
  seed: number,
): { rooms: Rect[]; corridors: [number, number][] } {
  const r = rng(seed)
  const out: Rect[] = []
  for (let tries = 0; out.length < rooms && tries < rooms * 40; tries++) {
    const w = r.int(3, 7)
    const h = r.int(3, 6)
    const room = {
      x: area.x + r.int(0, Math.max(0, area.w - w)),
      y: area.y + r.int(0, Math.max(0, area.h - h)),
      w,
      h,
    }
    const clear = out.every(
      (o) =>
        room.x + room.w + 1 <= o.x ||
        o.x + o.w + 1 <= room.x ||
        room.y + room.h + 1 <= o.y ||
        o.y + o.h + 1 <= room.y,
    )
    if (clear) out.push(room)
  }
  const corridors = out.slice(1).map((_, i) => [i, i + 1] as [number, number])
  return { rooms: out, corridors }
}

const center = (r: Rect) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) })

/** The ops that build a dungeon: a floor and its wall per room, corridors, torches. */
export function dungeonOps(area: Rect, rooms: number, seed: number, torches: boolean): MapOp[] {
  const plan = layout(area, rooms, seed)
  const entities: NewEntity[] = []
  for (const room of plan.rooms) {
    const pts = rectPoints(room)
    entities.push({ kind: "build", position: pts[0], points: pts, closed: true })
    entities.push({ kind: "wall", position: pts[0], points: pts, closed: true })
    if (torches)
      entities.push({
        kind: "object",
        position: { x: room.x + 0.5, y: room.y + 0.5 },
        asset: TORCH,
        data: { generated: true },
      })
  }
  for (const [a, b] of plan.corridors) {
    const p = center(plan.rooms[a])
    const q = center(plan.rooms[b])
    entities.push({ kind: "path", position: p, points: [p, { x: q.x, y: p.y }, q] })
  }
  return [{ op: "add", entities, under: true }]
}

export default defineExtension({
  async activate(ctx) {
    await ctx.generators.register({
      id: "dungeon",
      name: { es: "Mazmorra", en: "Dungeon" },
      scope: ["map", "area", "newMap"],
      params: [
        {
          kind: "slider",
          key: "rooms",
          label: { es: "Habitaciones", en: "Rooms" },
          default: 6,
          min: 2,
          max: 20,
          step: 1,
        },
        {
          kind: "switch",
          key: "torches",
          label: { es: "Antorchas", en: "Torches" },
          default: true,
        },
      ],
      preview: ({ params, seed, area, size }) => {
        const a = area ?? { x: 1, y: 1, w: (size?.width ?? 20) - 2, h: (size?.height ?? 20) - 2 }
        return layout(a, Number(params.rooms), seed).rooms.map((r) => ({
          kind: "build",
          position: r,
          points: rectPoints(r),
          closed: true,
        }))
      },
      generate: ({ params, seed, area, size }) => {
        const a = area ?? { x: 1, y: 1, w: (size?.width ?? 20) - 2, h: (size?.height ?? 20) - 2 }
        return dungeonOps(a, Number(params.rooms), seed, params.torches !== false)
      },
    })
    await ctx.generators.newMapPreset({
      id: "small-dungeon",
      name: { es: "Mazmorra chica", en: "Small dungeon" },
      width: 30,
      height: 24,
      generator: "dungeon",
    })

    // Stairs: a parametric entity, drawn from its data (steps, width), with handles.
    await ctx.render.entityType({
      id: "stairs",
      name: { es: "Escalera", en: "Stairs" },
      layer: 150,
      render: (e: Entity) => {
        const steps = Number(e.data.steps ?? 5)
        const width = Number(e.data.width ?? 2)
        return Array.from({ length: steps }, (_, i) => ({
          type: "path" as const,
          points: [
            { x: e.position.x, y: e.position.y + i * 0.4 },
            { x: e.position.x + width, y: e.position.y + i * 0.4 },
          ],
          stroke: "#d9d2c5",
          strokeWidth: 0.08,
        }))
      },
      hitShape: (e) =>
        rectPoints({
          x: e.position.x,
          y: e.position.y,
          w: Number(e.data.width ?? 2),
          h: Number(e.data.steps ?? 5) * 0.4,
        }),
      handles: (e) => [
        {
          id: "end",
          position: {
            x: e.position.x + Number(e.data.width ?? 2),
            y: e.position.y + Number(e.data.steps ?? 5) * 0.4,
          },
        },
      ],
      onHandle: (e, _handle, p) => [
        {
          op: "setData",
          id: e.id,
          data: {
            ...e.data,
            width: Math.max(1, Math.round(p.x - e.position.x)),
            steps: Math.max(2, Math.round((p.y - e.position.y) / 0.4)),
          },
        },
      ],
    })

    // Placing a torch lights it; objects placed get turned to face up.
    await ctx.tools.assetBehavior({
      id: "torch-light",
      match: { assets: [TORCH] },
      onPlaced: (e) => [
        {
          op: "add",
          entities: [
            {
              kind: "light",
              position: e.position,
              parent: e.id,
              params: { color: "#ffb347", range: 4 },
            },
          ],
        },
      ],
    })
    await ctx.tools.placementRule({
      id: "straighten",
      name: { es: "Enderezar", en: "Straighten" },
      kinds: ["object"],
      adjust: (e) => ({ ...e, rotation: Math.round((e.rotation ?? 0) / 90) * 90 }),
    })
    // A new floor drawn by hand gets counted in the map's data.
    await ctx.map.addReaction(async (change) => {
      if (!change.added.length) return []
      const floors = (await ctx.map.query({ kinds: ["build"] })).length
      const map = await ctx.map.get()
      return [{ op: "setMapData", data: { ...(map?.data ?? {}), floors } }]
    })

    await ctx.ui.command({
      id: "analyze",
      title: { es: "Analizar mazmorra", en: "Analyze dungeon" },
      run: async () => {
        const [rooms, grid] = await Promise.all([
          ctx.analysis.rooms(),
          ctx.analysis.walkability({ resolution: 1 }),
        ])
        const walkable = grid.cells.reduce((n, c) => n + c, 0)
        const path =
          rooms.length >= 2
            ? await ctx.analysis.path(roomCenter(rooms[0].polygon), roomCenter(rooms[1].polygon))
            : null
        const seen = rooms.length
          ? await ctx.analysis.visibility(roomCenter(rooms[0].polygon), 8)
          : []
        await ctx.ui.notify(
          `${rooms.length} habitaciones · ${walkable} casillas libres · camino ${path ? path.length : "—"} · visibles ${seen.length}`,
        )
      },
    })
  },
})

function roomCenter(poly: { x: number; y: number }[]) {
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  }
}
