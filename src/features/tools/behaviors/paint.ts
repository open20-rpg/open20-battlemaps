import { useEditorStore } from "../../../stores/editorStore"
import { addEntities, beginGesture, endGesture, updateEntity } from "../../map/commands"
import {
  TERRAIN_SLOTS,
  TERRAIN_TICK,
  blendTowards,
  brushMask,
  createTerrain,
  encodeWeights,
  filledWeights,
  resizeTerrain,
  stampOrigin,
  type TerrainData,
} from "../../map/model/terrain"
import { beginLiveTerrain, endLiveTerrain, touchLiveTerrain } from "../../map/terrainLive"
import { type MapEntity, type Vec2 } from "../../map/model/types"
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

/** The brush's slot textures (asset ids, padded to every terrain slot) and the picked slot. */
function brushSlots(params: Record<string, unknown>): { ids: (string | null)[]; slot: number } {
  const biome = params.biome as BiomeSelection | undefined
  const list = biome ? (biome.slotsByBiome[biome.biome] ?? []) : []
  const ids = Array.from({ length: TERRAIN_SLOTS }, (_, i) => list[i]?.id ?? null)
  return { ids, slot: biome?.selectedSlot ?? 0 }
}

const terrainOf = (entities: readonly MapEntity[]) =>
  entities.find((e) => e.toolId === "terrainBrush" && e.params.terrain)

const sameSlots = (a: (string | null)[], b: (string | null)[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

/**
 * The level's terrain, created (all slot 1) if it has none, with the
 * brush's slot textures and the map's current size. Returns its latest state.
 */
function ensureTerrain(ctx: ToolCtx): MapEntity | undefined {
  const { ids } = brushSlots(ctx.params)
  const existing = terrainOf(ctx.entities)
  if (!existing) {
    const e = makeEntity(ctx, {
      toolId: "terrainBrush",
      layer: -500,
      strokes: [],
      params: { terrain: createTerrain(ctx.map, ids) },
    })
    addEntities([e])
    return e
  }
  const data = existing.params.terrain as TerrainData
  const sized = resizeTerrain(data, ctx.map)
  if (sized === data && sameSlots(data.slots, ids)) return existing
  const terrain = { ...sized, slots: ids }
  updateEntity(existing.id, { params: { ...existing.params, terrain } })
  return { ...existing, params: { ...existing.params, terrain } }
}

/** Painting runs this many ticks at most per frame (after a stall, don't flood). */
const MAX_TICKS_PER_FRAME = 10

/**
 * Terrain Brush, as Dungeondraft paints: while the button is held, a stamp
 * lands at the pointer on every 60 Hz tick — even standing still, so lingering
 * paints more — each adding Intensity / 60 × the soft cone to the picked slot
 * (model/terrain.ts). The stroke paints a live buffer and lands in the
 * document on release, as one undo step. Fill sets the whole level to the
 * picked slot. Size is the brush's diameter in tiles.
 */
export function createTerrainBehavior(): ToolBehavior {
  let stroke: {
    entity: MapEntity
    data: TerrainData
    bytes: Uint8Array
    mask: ReturnType<typeof brushMask>
    size: number
    slot: number
    delta: number
    mapWidth: number
    pos: Vec2
    last: number
    acc: number
    frame: number
  } | null = null

  const stamp = () => {
    if (!stroke) return
    const { bytes, data, mask, pos, size, mapWidth, slot, delta } = stroke
    blendTowards(
      bytes,
      data.width,
      data.height,
      mask,
      stampOrigin(pos, size, mapWidth),
      slot,
      delta,
    )
  }
  const loop = (now: number) => {
    if (!stroke) return
    stroke.acc += Math.max(0, now - stroke.last) / 1000
    stroke.last = now
    let ticks = 0
    while (stroke.acc >= TERRAIN_TICK && ticks < MAX_TICKS_PER_FRAME) {
      stamp()
      stroke.acc -= TERRAIN_TICK
      ticks++
    }
    if (ticks === MAX_TICKS_PER_FRAME) stroke.acc = 0
    if (ticks > 0) touchLiveTerrain()
    stroke.frame = requestAnimationFrame(loop)
  }
  const finish = () => {
    if (!stroke) return
    if (stroke.frame) cancelAnimationFrame(stroke.frame)
    const { entity, data } = stroke
    stroke = null
    const terrain = endLiveTerrain(data)
    if (terrain) updateEntity(entity.id, { params: { ...entity.params, terrain } })
    endGesture()
  }
  const cursor = (ctx: ToolCtx, p: Vec2) =>
    useEditorStore
      .getState()
      .setDraft([{ kind: "circle", center: p, radius: paramNum(ctx.params.brushSize, 8) / 2 }])

  return {
    onPointerDown: (ctx, e) => {
      if (e.button !== 0 || ctx.params.enable === false || !terrainSlots(ctx.params.biome).selected)
        return
      beginGesture()
      const entity = ensureTerrain(ctx)
      if (!entity) return endGesture()
      const data = entity.params.terrain as TerrainData
      const size = paramNum(ctx.params.brushSize, 8)
      stroke = {
        entity,
        data,
        bytes: beginLiveTerrain(entity.id, data),
        mask: brushMask(size),
        size,
        slot: brushSlots(ctx.params).slot,
        delta: paramNum(ctx.params.intensity, 4) * TERRAIN_TICK,
        mapWidth: ctx.map.width,
        pos: { x: e.x, y: e.y },
        last: performance.now(),
        acc: 0,
        frame: 0,
      }
      // The first frame paints right away, as Dungeondraft's first _Update does.
      stamp()
      touchLiveTerrain()
      if (typeof requestAnimationFrame === "function") stroke.frame = requestAnimationFrame(loop)
    },
    onPointerMove: (ctx, e) => {
      cursor(ctx, e)
      if (stroke) stroke.pos = { x: e.x, y: e.y }
    },
    onPointerUp: () => finish(),
    onDeactivate: () => {
      finish()
      useEditorStore.getState().setDraft([])
    },
    onAction: (ctx, action) => {
      if (action !== "fill" || !terrainSlots(ctx.params.biome).selected) return
      beginGesture()
      const entity = ensureTerrain(ctx)
      if (entity) {
        const data = entity.params.terrain as TerrainData
        const weights = filledWeights(data.width, data.height, brushSlots(ctx.params).slot)
        const terrain = { ...data, weights: encodeWeights(weights) }
        updateEntity(entity.id, { params: { ...entity.params, terrain } })
      }
      endGesture()
    },
    isActionDisabled: (ctx, action) =>
      action === "fill" && !terrainSlots(ctx.params.biome).selected,
    onParamsChange: (ctx, patch) => {
      // Slot textures belong to the level's terrain: changing one repaints
      // everything painted with it, as in Dungeondraft.
      if (!("biome" in patch) || stroke) return
      const existing = terrainOf(ctx.entities)
      if (!existing) return
      const data = existing.params.terrain as TerrainData
      const { ids } = brushSlots(ctx.params)
      if (sameSlots(data.slots, ids)) return
      updateEntity(existing.id, {
        params: { ...existing.params, terrain: { ...data, slots: ids } },
      })
    },
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
