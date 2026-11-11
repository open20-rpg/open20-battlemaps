import { addEntities } from "../../map/commands"
import { type Vec2 } from "../../map/model/types"
import { type BiomeSelection, type Shape } from "../params"
import { brushController, makeEntity, paramNum, shapeController } from "./shared"
import { type PointerInfo, type ToolBehavior, type ToolCtx } from "./types"

/** Right-dragging with any brush erases. */
const rightButton = (_ctx: ToolCtx, e: PointerInfo) => e.button === 2

/** Cave: dig (or blast open) cave floor; walls form around the dug area. */
export function createCaveBehavior(): ToolBehavior {
  return {
    ...brushController({
      radius: (ctx) => paramNum(ctx.params.brushSize, 1),
      erase: (ctx, e) => ctx.params.brushMode === "blast" || e.button === 2,
      layer: () => -300,
      params: (ctx) => ({
        groundColor: ctx.params.groundColor,
        wallColor: ctx.params.wallColor,
        style: ctx.params.style,
      }),
    }),
    cursor: () => "crosshair",
  }
}

/** Water: paint with the brush, or drag/click out rectangle, ellipse or polygon bodies. */
export function createWaterBehavior(): ToolBehavior {
  const params = (ctx: ToolCtx) => ({
    deepColor: ctx.params.deepColor,
    shallowColor: ctx.params.shallowColor,
    blendDistance: paramNum(ctx.params.blendDistance, 1.5),
    disableBorder: ctx.params.disableBorder === true,
  })
  const brush = brushController({
    radius: (ctx) => paramNum(ctx.params.brushSize, 1),
    erase: rightButton,
    layer: () => 0,
    params,
  })
  const shape = shapeController((ctx, polygon: Vec2[]) =>
    addEntities([
      makeEntity(ctx, {
        layer: 0,
        points: polygon,
        closed: true,
        position: polygon[0],
        params: params(ctx),
      }),
    ]),
  )
  const pick = (ctx: ToolCtx): ToolBehavior =>
    ((ctx.params.shape as Shape | null) ?? "brush") === "brush" ? brush : shape
  return {
    onPointerDown: (ctx, e) => pick(ctx).onPointerDown?.(ctx, e),
    onPointerMove: (ctx, e) => pick(ctx).onPointerMove?.(ctx, e),
    onPointerUp: (ctx, e) => pick(ctx).onPointerUp?.(ctx, e),
    onDoubleClick: (ctx, e) => pick(ctx).onDoubleClick?.(ctx, e),
    onKeyDown: (ctx, e) => pick(ctx).onKeyDown?.(ctx, e) ?? false,
    onDeactivate: (ctx) => {
      brush.onDeactivate(ctx)
      shape.onDeactivate(ctx)
    },
    onParamsChange: (ctx, patch) => {
      if ("shape" in patch) {
        brush.onDeactivate(ctx)
        shape.onDeactivate(ctx)
      }
    },
    cursor: () => "crosshair",
  }
}

/** The texture in the Terrain Brush's selected biome slot (and slot 0, the base). */
export function terrainSlots(value: unknown): { selected?: string; base?: string } {
  const biome = value as BiomeSelection | undefined
  if (!biome) return {}
  const slots = biome.slotsByBiome[biome.biome] ?? []
  return { selected: slots[biome.selectedSlot ?? 0]?.id, base: slots[0]?.id }
}

/**
 * Terrain Brush: paint the selected biome slot's texture with a soft brush;
 * Fill replaces the whole terrain with it. Slot 0 is the base layer.
 */
export function createTerrainBehavior(): ToolBehavior {
  return {
    ...brushController({
      radius: (ctx) => paramNum(ctx.params.brushSize, 8) / 4,
      erase: rightButton,
      layer: () => -500,
      canPaint: (ctx) => ctx.params.enable !== false && !!terrainSlots(ctx.params.biome).selected,
      params: (ctx) => {
        const { selected, base } = terrainSlots(ctx.params.biome)
        return {
          texture: selected,
          base,
          intensity: paramNum(ctx.params.intensity, 4),
          smoothBlending: ctx.params.smoothBlending === true,
        }
      },
    }),
    onAction: (ctx, action) => {
      if (action !== "fill") return
      const { selected } = terrainSlots(ctx.params.biome)
      if (!selected) return
      addEntities([
        makeEntity(ctx, {
          layer: -500,
          params: { texture: selected, base: selected, fill: true },
          strokes: [],
        }),
      ])
    },
    isActionDisabled: (ctx, action) =>
      action === "fill" && !terrainSlots(ctx.params.biome).selected,
    cursor: () => "crosshair",
  }
}

/** Material: freehand-paint a tileset material onto a layer. */
export function createMaterialBehavior(): ToolBehavior {
  return {
    ...brushController({
      radius: (ctx) => paramNum(ctx.params.brushSize, 2) / 2,
      erase: rightButton,
      layer: (ctx) => paramNum(ctx.params.layer, -400),
      params: (ctx) => ({ material: ctx.params.material }),
    }),
    cursor: () => "crosshair",
  }
}
