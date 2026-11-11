import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { useEditorStore } from "../../../stores/editorStore"
import { useSettingsStore, type Prefab, type ShadowStyle } from "../../../stores/settingsStore"
import { useToolsStore } from "../../../stores/toolsStore"
import {
  addEntities,
  beginGesture,
  endGesture,
  setReferenceImage,
  updateReferenceImage,
} from "../../map/commands"
import {
  boundsOf,
  entityBounds,
  newId,
  translateEntity,
  type AssetSizeOf,
} from "../../map/model/geometry"
import { regroup } from "../../map/model/groups"
import { type MapEntity, type ReferenceImage, type Vec2 } from "../../map/model/types"
import { paramNum } from "./shared"
import { type ToolBehavior, type ToolCtx } from "./types"

const IMAGE_FILTERS = [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }]

/** Reference image params mirrored from the document. */
const refParams = (img: ReferenceImage | null | undefined) =>
  img ? { opacity: img.opacity, visible: img.visible, width: img.width } : null

/**
 * Reference Image: load an image to trace over, set its opacity/size, drag
 * it into place. The image settings live in the document (undoable); the
 * tool params mirror them.
 */
export function createReferenceImageBehavior(): ToolBehavior {
  let dragging: Vec2 | null = null
  return {
    onActivate: (ctx) => {
      const p = refParams(ctx.map.referenceImage)
      if (p) useToolsStore.getState().setToolParams(ctx.toolId, p)
    },
    onAction: (ctx, action) => {
      if (action === "remove") {
        setReferenceImage(null)
        return
      }
      if (action !== "load") return
      void openDialog({ filters: IMAGE_FILTERS, multiple: false }).then((path) => {
        if (!path || Array.isArray(path)) return
        setReferenceImage({
          path,
          opacity: paramNum(ctx.params.opacity, 0.5),
          visible: ctx.params.visible !== false,
          position: { x: 0, y: 0 },
          width: ctx.map.width,
        })
        useToolsStore.getState().setToolParams(ctx.toolId, { width: ctx.map.width })
      })
    },
    isActionDisabled: (ctx, action) => action === "remove" && !ctx.map.referenceImage,
    onParamsChange: (_ctx, patch) => {
      const next: Partial<ReferenceImage> = {}
      if (typeof patch.opacity === "number") next.opacity = patch.opacity
      if (typeof patch.visible === "boolean") next.visible = patch.visible
      if (typeof patch.width === "number") next.width = patch.width
      if (Object.keys(next).length > 0) updateReferenceImage(next)
    },
    onPointerDown: (ctx, e) => {
      if (e.button !== 0 || !ctx.map.referenceImage) return
      beginGesture()
      dragging = { x: e.x, y: e.y }
    },
    onPointerMove: (ctx, e) => {
      const img = ctx.map.referenceImage
      if (!dragging || !e.buttons || !img) return
      // The image spans map x ∈ [position.x, position.x + width]; a drag is
      // a plain translation in map space.
      updateReferenceImage({
        position: {
          x: img.position.x + (e.x - dragging.x),
          y: img.position.y + (e.y - dragging.y),
        },
      })
      dragging = { x: e.x, y: e.y }
    },
    onPointerUp: () => {
      if (dragging) endGesture()
      dragging = null
    },
    onDeactivate: () => {
      if (dragging) endGesture()
      dragging = null
    },
    cursor: () => "move",
  }
}

/** Build a prefab from entities: positions stored relative to the group's center. */
export function prefabFrom(
  entities: readonly MapEntity[],
  sizeOf: AssetSizeOf,
  name = "",
): Prefab | null {
  if (entities.length === 0) return null
  const boxes = entities.map((e) => entityBounds(e, sizeOf))
  const b = boundsOf(
    boxes.flatMap((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
    ]),
  )
  const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  return {
    id: newId("p"),
    name,
    entities: entities.map((e) => translateEntity(e, { x: -center.x, y: -center.y })),
  }
}

/** Copies of a prefab's entities centered at `p` on the level, with fresh ids. */
export function instantiatePrefab(prefab: Prefab, p: Vec2, level: string): MapEntity[] {
  return regroup(prefab.entities).map((e) => ({ ...translateEntity(e, p), id: newId(), level }))
}

/** Save the current selection as a prefab (Prefabs panel "Save selection"). */
export function saveSelectionAsPrefab(ctx: ToolCtx): Prefab | null {
  const ids = new Set(useEditorStore.getState().selection)
  const prefab = prefabFrom(
    ctx.entities.filter((e) => ids.has(e.id)),
    ctx.sizeOf,
  )
  if (prefab) {
    useSettingsStore.getState().addPrefab(prefab)
    useToolsStore.getState().setToolParams(ctx.toolId, { prefab: prefab.id })
  }
  return prefab
}

const selectedPrefab = (ctx: ToolCtx): Prefab | undefined => {
  const id = ctx.params.prefab
  return useSettingsStore.getState().prefabs.find((p) => p.id === id)
}

/** Prefabs: stamp the selected prefab where clicked; hover previews it. */
export function createPrefabsBehavior(): ToolBehavior {
  return {
    onPointerMove: (ctx, e) => {
      const prefab = selectedPrefab(ctx)
      useEditorStore.getState().setDraft(
        prefab
          ? instantiatePrefab(prefab, ctx.snap(e, 0.5), ctx.level).map((entity) => ({
              kind: "ghost" as const,
              entity,
            }))
          : [],
      )
    },
    onPointerDown: (ctx, e) => {
      const prefab = selectedPrefab(ctx)
      if (!prefab || e.button !== 0) return
      const copies = instantiatePrefab(prefab, ctx.snap(e, 0.5), ctx.level)
      addEntities(copies)
      useEditorStore.getState().select(copies.map((c) => c.id))
    },
    onAction: (ctx, action) => {
      if (action === "save") saveSelectionAsPrefab(ctx)
    },
    isActionDisabled: (_ctx, action) =>
      action === "save" && useEditorStore.getState().selection.length === 0,
    onDeactivate: () => useEditorStore.getState().setDraft([]),
    cursor: () => "crosshair",
  }
}

/**
 * Shadows: how drop shadows look (softness, offset, opacity). An app setting,
 * not part of the map; the tool's params mirror it.
 */
export function createShadowSettingsBehavior(): ToolBehavior {
  const mirror = (toolId: string) =>
    useToolsStore.getState().setToolParams(toolId, { ...useSettingsStore.getState().shadowStyle })
  return {
    onActivate: (ctx) => mirror(ctx.toolId),
    onParamsChange: (_ctx, patch) => {
      const next: Partial<ShadowStyle> = {}
      for (const key of ["blur", "offsetX", "offsetY", "opacity"] as const) {
        if (typeof patch[key] === "number") next[key] = patch[key]
      }
      if (Object.keys(next).length > 0) useSettingsStore.getState().setShadowStyle(next)
    },
    onAction: (ctx, action) => {
      if (action !== "reset") return
      useSettingsStore.getState().resetShadowStyle()
      mirror(ctx.toolId)
    },
  }
}
