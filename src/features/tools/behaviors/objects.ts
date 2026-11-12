import { useEditorStore } from "../../../stores/editorStore"
import { useToolsStore } from "../../../stores/toolsStore"
import { addEntities, beginGesture, endGesture } from "../../map/commands"
import { dist, normalizeDegrees } from "../../map/model/geometry"
import { type MapEntity, type Vec2 } from "../../map/model/types"
import { makeEntity, nudgeParam, paramNum, wheelDegrees } from "./shared"
import { type ToolBehavior, type ToolCtx } from "./types"
import { stepLibraryAsset } from "../../library/browsers"
import { TOOL_BY_ID } from "../definitions"
import { LIBRARY_PARAM } from "../params"

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

/** Pick the Library grid's next (or previous) asset for the tool. */
async function stepAsset(ctx: ToolCtx, dir: 1 | -1): Promise<void> {
  const category = TOOL_BY_ID.get(ctx.toolId)?.library
  if (!category) return
  const next = await stepLibraryAsset(category, ctx.libraryAssets[0], dir)
  if (next) useToolsStore.getState().setToolParams(ctx.toolId, { [LIBRARY_PARAM]: [next] })
}

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
    // Right-click: rotate 90° (snapped to quarter turns; −90° with Alt).
    if (e.button === 2) {
      const r = paramNum(ctx.params.rotation, 0)
      const quarter = e.altKey ? Math.ceil(r / 90) * 90 - 90 : Math.floor(r / 90) * 90 + 90
      useToolsStore.getState().setToolParams(ctx.toolId, { rotation: normalizeDegrees(quarter) })
      return
    }
    const id = ctx.libraryAssets[0]
    if (!id || e.button !== 0) return
    addEntities([objectAt(ctx, ctx.snap(e, OBJECT_SNAP), id)], under(ctx))
  },
  // Wheel: rotate (±15°, ±5° with Z); Alt+wheel: scale ±0.1; Shift+wheel
  // (or a sideways scroll): the next/previous asset of the Library grid.
  onWheel: (ctx, e) => {
    if (e.shiftKey || e.horizontal) {
      void stepAsset(ctx, e.dir === 1 ? -1 : 1)
      return true
    }
    if (e.altKey) nudgeParam(ctx, "scale", e.dir * 0.1, 0.1, 4, 1)
    else {
      const r = paramNum(ctx.params.rotation, 0) + e.dir * wheelDegrees()
      useToolsStore.getState().setToolParams(ctx.toolId, { rotation: normalizeDegrees(r) })
    }
    return true
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
  /** Which of the picked assets to place (default: one at random). */
  pick?: number,
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
      asset: ids[(pick ?? Math.floor(rnd() * ids.length)) % ids.length],
      color: str(ctx.params.customColor, ""),
      shadow: ctx.params.shadow !== false,
    },
  })
}

/** Scatter: drag to spray random objects from the Library selection, spaced by Spread. */
export function createScatterBehavior(): ToolBehavior {
  let last: Vec2 | null = null
  /** The asset the next placement uses (re-rolled after each, or with Shift+wheel). */
  let next = 0
  const reroll = (ctx: ToolCtx) => {
    const n = ctx.libraryAssets.length
    next = n > 1 ? (next + 1 + Math.floor(Math.random() * (n - 1))) % n : 0
  }
  const place = (ctx: ToolCtx, p: Vec2) => {
    const e = scatterAt(ctx, p, Math.random, next)
    if (e) addEntities([e], under(ctx))
    reroll(ctx)
    last = p
  }
  return {
    // Shift+wheel (or a sideways scroll): another random asset for the next placement.
    onWheel: (ctx, e) => {
      if (!e.shiftKey && !e.horizontal) return false
      reroll(ctx)
      return true
    },
    onPointerDown: (ctx, e) => {
      // Ctrl+click is left alone (Ctrl is for zooming), as in Dungeondraft.
      if (e.button !== 0 || e.ctrlKey || ctx.libraryAssets.length === 0) return
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
