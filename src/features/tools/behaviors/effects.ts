import { useEditorStore, type DraftShape } from "../../../stores/editorStore"
import { useToolsStore } from "../../../stores/toolsStore"
import {
  addEntities,
  beginGesture,
  endGesture,
  moveEntities,
  setBuildingWear,
  setEnvironment,
} from "../../map/commands"
import { dist, normalizeDegrees } from "../../map/model/geometry"
import { isBuildingWear, type MapEntity, type Vec2 } from "../../map/model/types"
import { makeEntity, nudgeParam, paramNum, screenTiles } from "./shared"
import { type ToolBehavior, type ToolCtx } from "./types"

/**
 * Environment: map-wide ambient light. Its param mirrors the document's
 * `environment` — loaded into the panel on activation, written back (as an
 * undoable command) on change.
 */
export const environmentBehavior: ToolBehavior = {
  onActivate: (ctx) => {
    const ambient = ctx.map.environment.ambientLight
    if (ctx.params.ambientLight !== ambient) {
      useToolsStore.getState().setToolParams(ctx.toolId, { ambientLight: ambient })
    }
  },
  onParamsChange: (_ctx, patch) => {
    if (typeof patch.ambientLight === "string") setEnvironment({ ambientLight: patch.ambientLight })
  },
}

/**
 * Map Settings: its Building Wear param mirrors the document's
 * `buildingWear` (loaded on activation, written back as an undoable command).
 */
export const mapSettingsBehavior: ToolBehavior = {
  onActivate: (ctx) => {
    if (ctx.params.buildingWear !== ctx.map.buildingWear) {
      useToolsStore.getState().setToolParams(ctx.toolId, { buildingWear: ctx.map.buildingWear })
    }
  },
  onParamsChange: (ctx, patch) => {
    const wear = patch.buildingWear
    if (isBuildingWear(wear) && wear !== ctx.map.buildingWear) setBuildingWear(wear)
  },
}

export function lightAt(ctx: ToolCtx, p: Vec2): MapEntity {
  return makeEntity(ctx, {
    layer: 700,
    position: p,
    rotation: paramNum(ctx.params.rotation, 0),
    params: {
      range: paramNum(ctx.params.range, 5),
      intensity: paramNum(ctx.params.intensity, 1),
      shadow: ctx.params.shadow !== false,
      color: ctx.params.color,
      style: ctx.params.style,
    },
  })
}

/**
 * Light: a tap places a light where it's released (pressing previews it,
 * dragging moves the preview — touch has no hover); dragging an existing
 * light's center moves it.
 */
export function createLightBehavior(): ToolBehavior {
  let dragging: { id: string; last: Vec2 } | null = null
  /** A press on empty map: the light goes where it's released. */
  let placing = false
  // Locked ones are left alone: no widget, no dragging.
  const lights = (ctx: ToolCtx) => ctx.entities.filter((e) => e.toolId === "light" && !e.locked)
  // Widgets (range circles + center handles of placed lights) follow the
  // Widgets param; the hover preview (the light's real glow) always shows.
  const showWidgets = (ctx: ToolCtx, hover?: Vec2) => {
    const draft: DraftShape[] =
      ctx.params.widgets === false
        ? []
        : lights(ctx).flatMap((l) => [
            { kind: "circle" as const, center: l.position, radius: paramNum(l.params.range, 5) },
            { kind: "handles" as const, points: [l.position] },
          ])
    if (hover) {
      draft.push({ kind: "ghost", entity: lightAt(ctx, hover) })
      draft.push({ kind: "circle", center: hover, radius: paramNum(ctx.params.range, 5) })
    }
    useEditorStore.getState().setDraft(draft)
  }
  return {
    // Wheel: range ±1 (±0.1 with Shift); Alt+wheel: rotate ±5°.
    onWheel: (ctx, e) => {
      if (e.altKey) {
        const r = paramNum(ctx.params.rotation, 0) + e.dir * 5
        useToolsStore.getState().setToolParams(ctx.toolId, { rotation: normalizeDegrees(r) })
      } else nudgeParam(ctx, "range", e.dir * (e.shiftKey ? 0.1 : 1), 0.5, 20, 5, 1)
      return true
    },
    onActivate: (ctx) => showWidgets(ctx),
    onPointerDown: (ctx, e) => {
      if (e.button !== 0) return
      const hit = lights(ctx).find((l) => dist(l.position, e) <= screenTiles(10))
      if (hit) {
        beginGesture()
        dragging = { id: hit.id, last: { x: e.x, y: e.y } }
        return
      }
      placing = true
      showWidgets(ctx, ctx.snap(e, 0.5))
    },
    onPointerMove: (ctx, e) => {
      if (dragging && e.buttons) {
        const p = ctx.snap(e, 0.5)
        const light = ctx.map.entities.find((l) => l.id === dragging?.id)
        if (light)
          moveEntities([light.id], { x: p.x - light.position.x, y: p.y - light.position.y })
        dragging.last = p
      }
      showWidgets(ctx, dragging ? undefined : ctx.snap(e, 0.5))
    },
    onPointerUp: (ctx, e) => {
      if (dragging) endGesture()
      dragging = null
      if (placing) addEntities([lightAt(ctx, ctx.snap(e, 0.5))])
      placing = false
    },
    onParamsChange: (ctx) => showWidgets(ctx),
    onDeactivate: () => {
      if (dragging) endGesture()
      dragging = null
      placing = false
      useEditorStore.getState().setDraft([])
    },
    cursor: () => "crosshair",
  }
}
