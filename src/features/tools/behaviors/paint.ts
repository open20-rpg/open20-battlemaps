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
import { isHeld } from "../../shortcuts/held"
import { brushCursorRadius, brushRadius, STAMP_SPACING } from "../../map/render/cells"
import { beginLiveTerrain, endLiveTerrain, touchLiveTerrain } from "../../map/terrainLive"
import { type TexelRect } from "../../map/render/splat"
import { type MapEntity, type Vec2 } from "../../map/model/types"
import { type BiomeSelection, type Shape } from "../params"
import { brushController, makeEntity, paramNum, shapeController } from "./shared"
import { type PointerInfo, type ToolBehavior, type ToolCtx } from "./types"

/** A brush erases while the invert shortcut (Alt) is held, or when dragged with the right button. */
const inverted = (_ctx: ToolCtx, e: PointerInfo) => e.button === 2 || isHeld("invert")

/** Dungeondraft's cell-stamp brush (cave, water): its size, cursor and stamp spacing. */
const stampBrush = {
  radius: (ctx: ToolCtx) => brushRadius(paramNum(ctx.params.brushSize, 1)),
  cursorRadius: (ctx: ToolCtx) => brushCursorRadius(paramNum(ctx.params.brushSize, 1)),
  spacing: STAMP_SPACING,
}

/**
 * Cave, as Dungeondraft's: dig cave floor (walls form around it), or Blast
 * Open — paint the blasted area, where the floor fades out and the walls
 * open; Alt (or right-drag) undoes either.
 */
export function createCaveBehavior(): ToolBehavior {
  return {
    ...brushController({
      ...stampBrush,
      erase: inverted,
      blast: (ctx) => ctx.params.brushMode === "blast",
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

/**
 * Water: paint with the brush, or drag/click out rectangle, ellipse or
 * polygon bodies (with Alt, shapes that remove water).
 */
export function createWaterBehavior(): ToolBehavior {
  const params = (ctx: ToolCtx) => ({
    deepColor: ctx.params.deepColor,
    shallowColor: ctx.params.shallowColor,
    blendDistance: paramNum(ctx.params.blendDistance, 1.5),
    disableBorder: ctx.params.disableBorder === true,
  })
  const brush = brushController({
    ...stampBrush,
    erase: inverted,
    layer: () => 0,
    params,
  })
  // Alt (invert) draws a shape that cuts the water away instead.
  const shape = shapeController((ctx, polygon: Vec2[]) =>
    addEntities([
      makeEntity(ctx, {
        layer: 0,
        points: polygon,
        closed: true,
        position: polygon[0],
        params: { ...params(ctx), ...(isHeld("invert") ? { erase: true } : {}) },
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
    onWheel: (ctx, e) => pick(ctx).onWheel?.(ctx, e) ?? false,
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

const unionRect = (a: TexelRect, b: TexelRect): TexelRect => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
})

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

  /** One stamp at the pointer; what it covered (a texel more each way: weights are filtered). */
  const stamp = (): TexelRect | undefined => {
    if (!stroke) return undefined
    const { bytes, data, mask, pos, size, mapWidth, slot, delta } = stroke
    const origin = stampOrigin(pos, size, mapWidth)
    blendTowards(bytes, data.width, data.height, mask, origin, slot, delta)
    return {
      x0: origin.x - 1,
      y0: origin.y - 1,
      x1: origin.x + mask.side + 1,
      y1: origin.y + mask.side + 1,
    }
  }
  const loop = (now: number) => {
    if (!stroke) return
    stroke.acc += Math.max(0, now - stroke.last) / 1000
    stroke.last = now
    let ticks = 0
    let painted: TexelRect | undefined
    while (stroke.acc >= TERRAIN_TICK && ticks < MAX_TICKS_PER_FRAME) {
      const r = stamp()
      if (r) painted = painted ? unionRect(painted, r) : r
      stroke.acc -= TERRAIN_TICK
      ticks++
    }
    if (ticks === MAX_TICKS_PER_FRAME) stroke.acc = 0
    if (painted) touchLiveTerrain(painted)
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
      touchLiveTerrain(stamp())
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
      // The level's first terrain: as soon as slot 1 has a texture, the whole
      // ground is filled with it (instead of waiting for the first stroke).
      if (!existing) {
        if (brushSlots(ctx.params).ids[0]) ensureTerrain(ctx)
        return
      }
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
      erase: inverted,
      layer: (ctx) => paramNum(ctx.params.layer, -400),
      params: (ctx) => ({ material: ctx.params.material }),
    }),
    cursor: () => "crosshair",
  }
}
