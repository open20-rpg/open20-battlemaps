import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { DEFAULT_POST_PROCESS, POST_FILTERS, type PostProcess } from "../../../lib/postProcess"
import { useEditorStore } from "../../../stores/editorStore"
import { useSettingsStore, type Prefab, type ShadowStyle } from "../../../stores/settingsStore"
import { useToolsStore } from "../../../stores/toolsStore"
import { useMapStore } from "../../../stores/mapStore"
import {
  addEntities,
  beginGesture,
  endGesture,
  setPostProcess,
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
import { SHADOW_KINDS } from "../../map/render/entities"
import { paramNum, placeController } from "./shared"
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
    // Wheel scales the image: ±1 tile wide (±0.1 with Shift).
    onWheel: (ctx, e) => {
      const img = ctx.map.referenceImage
      if (!img) return false
      const width = Math.max(1, Math.round((img.width + e.dir * (e.shiftKey ? 0.1 : 1)) * 10) / 10)
      updateReferenceImage({ width })
      useToolsStore.getState().setToolParams(ctx.toolId, { width })
      return true
    },
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

/** Prefabs: stamp the selected prefab where released (placeController); hover previews it. */
export function createPrefabsBehavior(): ToolBehavior {
  return {
    ...placeController({
      preview: (ctx, e) => {
        const prefab = selectedPrefab(ctx)
        return prefab ? instantiatePrefab(prefab, ctx.snap(e, 0.5), ctx.level) : []
      },
      place: (ctx, e) => {
        const prefab = selectedPrefab(ctx)
        if (!prefab) return
        const copies = instantiatePrefab(prefab, ctx.snap(e, 0.5), ctx.level)
        addEntities(copies)
        useEditorStore.getState().select(copies.map((c) => c.id))
      },
    }),
    onAction: (ctx, action) => {
      if (action === "save") saveSelectionAsPrefab(ctx)
    },
    isActionDisabled: (_ctx, action) =>
      action === "save" && useEditorStore.getState().selection.length === 0,
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
      for (const key of ["blur", "offsetX", "offsetY", "opacity", "lightSoftness"] as const) {
        if (typeof patch[key] === "number") next[key] = patch[key]
      }
      if (typeof patch.color === "string") next.color = patch.color
      for (const key of SHADOW_KINDS) {
        if (typeof patch[key] === "boolean") next[key] = patch[key]
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

/**
 * Post-processing: color adjustments over the rendered map. Part of the
 * map (saved and loaded with it; new maps start without any): the params
 * mirror the document's, and changes are undoable commands.
 */
export function createPostProcessingBehavior(): ToolBehavior {
  const mirror = (toolId: string) => {
    const pp = useMapStore.getState().map?.postProcess
    if (pp) useToolsStore.getState().setToolParams(toolId, { ...pp })
  }
  return {
    onActivate: (ctx) => mirror(ctx.toolId),
    onParamsChange: (ctx, patch) => {
      const current = ctx.map.postProcess
      const next: Partial<PostProcess> = {}
      for (const key of ["brightness", "contrast", "saturation", "threshold"] as const) {
        if (typeof patch[key] === "number" && patch[key] !== current[key]) next[key] = patch[key]
      }
      const filter = POST_FILTERS.find((f) => f === patch.filter)
      if (filter && filter !== current.filter) next.filter = filter
      if (Object.keys(next).length > 0) setPostProcess(next)
    },
    onAction: (ctx, action) => {
      if (action !== "reset") return
      setPostProcess(DEFAULT_POST_PROCESS)
      mirror(ctx.toolId)
    },
  }
}
