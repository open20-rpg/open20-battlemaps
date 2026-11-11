import { useEditorStore } from "../../../stores/editorStore"
import { addEntities, beginGesture, endGesture } from "../../map/commands"
import { dist } from "../../map/model/geometry"
import { type MapEntity, type Vec2 } from "../../map/model/types"
import { makeEntity, paramNum } from "./shared"
import { type ToolBehavior, type ToolCtx } from "./types"

/** Objects snap to half tiles (cell centers and corners). */
const OBJECT_SNAP = 0.5

const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback)

/** The object entity the Object tool would place at `p` with its current params. */
export function objectAt(ctx: ToolCtx, p: Vec2, assetId: string): MapEntity {
  return makeEntity(ctx, {
    toolId: "object",
    layer: paramNum(ctx.params.layer, 100),
    position: p,
    rotation: paramNum(ctx.params.rotation, 0),
    scale: paramNum(ctx.params.scale, 1),
    flipX: ctx.params.mirror === true || undefined,
    params: {
      asset: assetId,
      color: str(ctx.params.customColor, ""),
      shadow: ctx.params.shadow !== false,
      blockLight: ctx.params.blockLight === true,
    },
  })
}

const under = (ctx: ToolCtx) => ctx.params.sorting === "under"

/** Object: click to stamp the asset picked in the Library; hover shows a preview. */
export const objectBehavior: ToolBehavior = {
  onPointerMove: (ctx, e) => {
    const id = ctx.libraryAssets[0]
    if (!id) return
    useEditorStore
      .getState()
      .setDraft([{ kind: "ghost", entity: objectAt(ctx, ctx.snap(e, OBJECT_SNAP), id) }])
  },
  onPointerDown: (ctx, e) => {
    const id = ctx.libraryAssets[0]
    if (!id || e.button !== 0) return
    addEntities([objectAt(ctx, ctx.snap(e, OBJECT_SNAP), id)], under(ctx))
  },
  onDeactivate: () => useEditorStore.getState().setDraft([]),
  cursor: () => "crosshair",
}

/** Uniform random number in [min, max]. */
const between = (range: unknown, fallback: [number, number], rnd: () => number) => {
  const [a, b] = Array.isArray(range) && range.length === 2 ? (range as [number, number]) : fallback
  return a + (b - a) * rnd()
}

/** Distance between scattered objects for a Spread param (-1..4). */
export function scatterSpacing(spread: number): number {
  return Math.max(0.25, 1 + spread)
}

/** One scattered object at `p`: random asset among the picked ones, random rotation/scale. */
export function scatterAt(
  ctx: ToolCtx,
  p: Vec2,
  rnd: () => number = Math.random,
): MapEntity | null {
  const ids = ctx.libraryAssets
  if (ids.length === 0) return null
  const spacing = scatterSpacing(paramNum(ctx.params.spread, 0.5))
  // Jitter within a fraction of the spacing so rows don't look gridded.
  const jitter = spacing * 0.4
  return makeEntity(ctx, {
    toolId: "scatter",
    layer: paramNum(ctx.params.layer, 100),
    position: { x: p.x + (rnd() - 0.5) * jitter, y: p.y + (rnd() - 0.5) * jitter },
    rotation: between(ctx.params.rotation, [-180, 180], rnd),
    scale: between(ctx.params.scale, [1, 1], rnd),
    params: {
      asset: ids[Math.floor(rnd() * ids.length) % ids.length],
      color: str(ctx.params.customColor, ""),
      shadow: ctx.params.shadow !== false,
    },
  })
}

/** Scatter: drag to spray random objects from the Library selection, spaced by Spread. */
export function createScatterBehavior(): ToolBehavior {
  let last: Vec2 | null = null
  const place = (ctx: ToolCtx, p: Vec2) => {
    const e = scatterAt(ctx, p)
    if (e) addEntities([e], under(ctx))
    last = p
  }
  return {
    onPointerDown: (ctx, e) => {
      if (e.button !== 0 || ctx.libraryAssets.length === 0) return
      beginGesture()
      place(ctx, e)
    },
    onPointerMove: (ctx, e) => {
      const spacing = scatterSpacing(paramNum(ctx.params.spread, 0.5))
      useEditorStore.getState().setDraft([{ kind: "circle", center: e, radius: spacing / 2 }])
      if (!last || !e.buttons) return
      if (dist(last, e) >= spacing) place(ctx, e)
    },
    onPointerUp: () => {
      if (last) endGesture()
      last = null
    },
    onDeactivate: () => {
      if (last) endGesture()
      last = null
      useEditorStore.getState().setDraft([])
    },
    cursor: () => "crosshair",
  }
}
