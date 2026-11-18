import { type DraftShape, useEditorStore } from "../../../stores/editorStore"
import { useToolsStore } from "../../../stores/toolsStore"
import { entityBounds, hitTest, type Rect } from "../../map/model/geometry"
import { type MapDocument, type MapEntity } from "../../map/model/types"
import { assetRefsOf, collectAssetIds, findMissingAssets } from "../../map/missingAssets"
import { assetCache } from "../../map/render/assets"
import { focusView } from "../../map/render/focus"
import { NO_FOCUS, type MissingFocus } from "../params"
import { type ToolBehavior, type ToolCtx } from "./types"

const focusOf = (ctx: ToolCtx): MissingFocus => (ctx.params.focus as MissingFocus) ?? NO_FOCUS

const isMissing = (id: string) => assetCache.isMissing(id)

/** Where an entity sits, as shown and framed: the terrain covers the whole map. */
function areaOf(e: MapEntity, map: MapDocument, ctx: ToolCtx): Rect {
  if (e.toolId === "terrainBrush") return { x: 0, y: 0, w: map.width, h: map.height }
  return entityBounds(e, ctx.sizeOf)
}

/** Bounds of several rects (null for none). */
function union(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Bring the focused use(s) into view: the level they're on (the active one
 * when it has any) and a view framing them.
 */
function show(ctx: ToolCtx, focus: MissingFocus): void {
  const item = findMissingAssets(ctx.map.entities, isMissing).find((m) => m.id === focus.asset)
  if (!item) return
  const byId = new Map(ctx.map.entities.map((e) => [e.id, e]))
  const uses = item.entityIds.flatMap((id) => byId.get(id) ?? [])
  const current = focus.index === null ? null : uses[focus.index]
  const level = current
    ? current.level
    : uses.some((e) => (e.level ?? ctx.level) === ctx.level)
      ? ctx.level
      : uses[0]?.level
  if (level && level !== ctx.level) useEditorStore.getState().setActiveLevel(level)
  const shown = current ? [current] : uses.filter((e) => (e.level ?? level) === level)
  const area = union(shown.map((e) => areaOf(e, ctx.map, ctx)))
  if (area) focusView(area)
}

/**
 * Replace Assets: lists what the map uses but can't draw (its control, see
 * controls/MissingAssetsControl) and marks it on the map — every missing
 * use faintly, the picked asset's uses strongly, the one being shown most.
 * Clicking a marked spot on the map picks its asset.
 */
export function createReplaceAssetsBehavior(): ToolBehavior {
  return {
    // Uses on other levels were never drawn, so never looked up.
    onActivate: (ctx) => assetCache.prefetch(collectAssetIds(ctx.map.entities)),

    onParamsChange: (ctx, patch) => {
      const focus = patch.focus as MissingFocus | undefined
      if (focus?.asset) show(ctx, focus)
    },

    onPointerDown: (ctx, e) => {
      if (e.button !== 0) return
      const hit = hitTest(ctx.entities, e, ctx.sizeOf, (ent) =>
        assetRefsOf(ent).some((r) => isMissing(r.id)),
      )
      if (!hit) return
      const ids = new Set(assetRefsOf(hit).map((r) => r.id))
      const item = findMissingAssets(ctx.map.entities, isMissing).find((m) => ids.has(m.id))
      if (!item) return
      const focus: MissingFocus = { asset: item.id, index: item.entityIds.indexOf(hit.id) }
      // Picked where it is already in view: no need to move the camera.
      useToolsStore.getState().setToolParams(ctx.toolId, { focus })
    },

    overlay: (ctx) => {
      const focus = focusOf(ctx)
      const missing = findMissingAssets(ctx.entities, isMissing)
      const byId = new Map(ctx.entities.map((e) => [e.id, e]))
      const out: DraftShape[] = []
      const focused: DraftShape[] = []
      for (const item of missing) {
        const mine = item.id === focus.asset
        // Indexes count every use of the asset, on any level.
        const all = mine
          ? findMissingAssets(ctx.map.entities, isMissing).find((m) => m.id === item.id)
          : undefined
        const currentId = mine && focus.index !== null ? all?.entityIds[focus.index] : undefined
        for (const id of item.entityIds) {
          const e = byId.get(id)
          if (!e) continue
          // A missing terrain texture would tint the whole map: marked only when picked.
          if (!mine && e.toolId === "terrainBrush") continue
          const rect = areaOf(e, ctx.map, ctx)
          if (!mine) out.push({ kind: "highlight", rect, emphasis: "dim" })
          else
            focused.push({
              kind: "highlight",
              rect,
              emphasis: id === currentId ? "current" : "focus",
            })
        }
      }
      // The picked asset draws over the rest, its current use last of all.
      focused.sort(
        (a, b) =>
          Number(a.kind === "highlight" && a.emphasis === "current") -
          Number(b.kind === "highlight" && b.emphasis === "current"),
      )
      return [...out, ...focused]
    },

    cursor: () => "pointer",
  }
}
