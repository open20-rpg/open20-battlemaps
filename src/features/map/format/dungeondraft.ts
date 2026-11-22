import { linkRooms } from "../model/links"
import { MATERIAL_CELLS_PER_TILE, stampRadius } from "../render/cells"
import { newId, pointInPolygon, rotateAround } from "../model/geometry"
import {
  TERRAIN_SLOTS,
  TEXELS_PER_TILE,
  encodeWeights,
  filledWeights,
  type TerrainData,
} from "../model/terrain"
import {
  createDocument,
  DEFAULT_BUILDING_WEAR,
  isBuildingWear,
  type BuildingWear,
  type BrushStroke,
  type MapDocument,
  type MapEntity,
  type MapLevel,
  type Vec2,
} from "../model/types"
import { argbToHex, parsePoolBytes, parsePoolInt, parsePoolVec2, parseVec2 } from "./godot"

/**
 * Importer for Dungeondraft maps (`.dungeondraft_map`, save format 3) into
 * the Open20 Battle Maps document model. Field semantics follow the format notes in
 * docs/dungeondraft-map-format.md (reconstructed for interoperability).
 *
 * Coordinates: Dungeondraft uses 256 world px per grid cell with x growing to
 * the right; Open20 Battle Maps map space is in cells with x mirrored (0 at the right
 * edge), so `x' = width − x/256`, `y' = y/256`. Angles stay screen-clockwise
 * (radians → degrees).
 *
 * Bitmap areas (caves, materials, terrain splats) become brush strokes, one
 * per horizontal run of set samples. Anything Open20 Battle Maps can't represent is
 * reported as a warning instead of being silently dropped.
 */

/** Dungeondraft world px per grid cell. */
const PX = 256

export type ImportWarningKey =
  | "builtinAssets"
  | "embeddedAssets"
  | "waterHoles"
  | "looseTiles"
  | "levelAmbient"
  | "traceImageSize"
  /** Text fonts not in the Google Fonts catalog (set once fonts are resolved, in io.ts). */
  | "unknownFonts"

export interface ImportResult {
  doc: MapDocument
  /** Pack ids the map depends on: its asset manifest plus any its assets reference. */
  packs: string[]
  /** Grid line color (Map Settings), when the map sets one. */
  gridColor?: string
  /** Index into `doc.levels` of the level the map was last edited on. */
  currentLevel: number
  /** Features Open20 Battle Maps couldn't carry over, with how many times each occurred. */
  warnings: Partial<Record<ImportWarningKey, number>>
  /** Terrain brush setup of the level the map opens on. */
  terrain?: TerrainSetup
}

export class DungeondraftImportError extends Error {}

type Json = Record<string, unknown>
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback)
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const deg = (rad: number) => (rad * 180) / Math.PI
/** An angle in degrees within (-180, 180] (what the Pattern tool's rotation takes). */
const wrapDeg = (d: number) => {
  const w = ((((d + 180) % 360) + 360) % 360) - 180
  return w === -180 ? 180 : w
}

/** Parse a Godot literal, or undefined when it's absent/malformed. */
function tryParse<T>(fn: (v: unknown) => T, value: unknown): T | undefined {
  try {
    return fn(value)
  } catch {
    return undefined
  }
}

/** Mutable conversion state shared by the section converters. */
class Importer {
  readonly warnings: ImportResult["warnings"] = {}
  /** Packs the converted assets come from (the manifest can miss some). */
  readonly packs = new Set<string>()

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  warn(key: ImportWarningKey, count = 1): void {
    this.warnings[key] = (this.warnings[key] ?? 0) + count
  }

  /** Dungeondraft world px → Open20 Battle Maps map tiles. */
  p(v: Vec2): Vec2 {
    return { x: this.width - v.x / PX, y: v.y / PX }
  }

  /** Texture resource path → library asset id, counting what won't resolve. */
  asset(res: unknown): string | undefined {
    const path = str(res)
    if (!path) return undefined
    if (path.startsWith("embedded://")) this.warn("embeddedAssets")
    else if (!path.startsWith("res://packs/")) this.warn("builtinAssets")
    const id = resToAssetId(path)
    const pack = packOfRes(path)
    if (pack) this.packs.add(pack)
    return id
  }

  /** Apply a node transform (position, rotation rad, scale) to local points. */
  local(points: Vec2[], position: Vec2, rotation: number, scale: Vec2): Vec2[] {
    return points.map((q) =>
      rotateAround(
        { x: q.x * scale.x + position.x, y: q.y * scale.y + position.y },
        position,
        deg(rotation),
      ),
    )
  }
}

const PACK_RES = /^res:\/\/packs\/([^/]+)\/(.+)$/

/**
 * Texture resource path → library asset id. Pack assets live under
 * `res://packs/<id>/…`; anything else is Dungeondraft's built-in library (not
 * available outside Dungeondraft) or an embedded image, kept under a
 * `dungeondraft|` id that never resolves.
 */
export function resToAssetId(path: string): string {
  const m = PACK_RES.exec(path)
  return m ? `${m[1]}|${m[2]}` : `dungeondraft|${path.replace(/^res:\/\//, "")}`
}

/** The pack id of a `res://packs/<id>/…` path (undefined for anything else). */
const packOfRes = (path: string): string | undefined => PACK_RES.exec(path)?.[1]

const vec = (v: unknown, fallback: Vec2 = { x: 0, y: 0 }): Vec2 =>
  tryParse(parseVec2, v) ?? fallback

/** Read bit `n` of a Godot BitMap's data (LSB-first). */
export function bitAt(bytes: Uint8Array, n: number): boolean {
  return ((bytes[n >> 3] ?? 0) >> (n & 7)) & 1 ? true : false
}

/** Horizontal runs of set samples per row: [row, firstCol, lastCol]. */
export function bitmapRuns(bytes: Uint8Array, w: number, h: number): [number, number, number][] {
  const runs: [number, number, number][] = []
  for (let y = 0; y < h; y++) {
    let start = -1
    for (let x = 0; x <= w; x++) {
      const on = x < w && bitAt(bytes, y * w + x)
      if (on && start < 0) start = x
      if (!on && start >= 0) {
        runs.push([y, start, x - 1])
        start = -1
      }
    }
  }
  return runs
}

/**
 * Strokes covering a marching-squares bitmap (caves: 64 px cells, materials:
 * 128 px). Grid size and the one-sample edge buffer follow the format notes.
 */
function bitmapStrokes(
  im: Importer,
  literal: unknown,
  cellPx: number,
  /** Stroke radius in tiles (default: soft strokes covering each cell). */
  radius = (cellPx / PX) * 0.75,
): BrushStroke[] {
  const bytes = tryParse(parsePoolBytes, literal)
  if (!bytes) return []
  const gridW = Math.round((im.width * PX) / cellPx) + 3
  const gridH = Math.round((im.height * PX) / cellPx) + 3
  return bitmapRuns(bytes, gridW, gridH).map(([y, x0, x1]) => ({
    points: [
      im.p({ x: (x0 - 1) * cellPx, y: (y - 1) * cellPx }),
      im.p({ x: (x1 - 1) * cellPx, y: (y - 1) * cellPx }),
    ],
    radius,
  }))
}

/**
 * The group an item belongs to and whether it's locked: Dungeondraft stores
 * groups ("prefabs" in its code) as a shared `prefab_id` on each member, a
 * decimal string, map-wide, and the lock as an optional `locked` bool.
 */
function grouped(raw: Json): Pick<MapEntity, "group" | "locked"> {
  const id = raw.prefab_id
  return {
    ...(typeof id === "string" && id !== "" ? { group: `dd-${id}` } : {}),
    ...(raw.locked === true ? { locked: true } : {}),
  }
}

function entity(
  level: string,
  fields: Partial<MapEntity> & Pick<MapEntity, "toolId" | "layer">,
): MapEntity {
  return { id: newId(), level, position: { x: 0, y: 0 }, rotation: 0, params: {}, ...fields }
}

const selection = (assetId: string | undefined, color = "#ffffff") => ({
  assets: assetId ? [assetId] : [],
  color,
})

/**
 * A Godot node scale as Open20 Battle Maps sprite fields: negative components are
 * mirrors (`mirror` is baked into scale.x < 0), magnitudes average into the
 * uniform scale (Dungeondraft only ever scales props uniformly, give or take
 * float noise).
 */
export function spriteScale(scale: Vec2): Pick<MapEntity, "scale" | "flipX" | "flipY"> {
  const out: Pick<MapEntity, "scale" | "flipX" | "flipY"> = {
    scale: (Math.abs(scale.x) + Math.abs(scale.y)) / 2 || 1,
  }
  if (scale.x < 0) out.flipX = true
  if (scale.y < 0) out.flipY = true
  return out
}

function portal(im: Importer, level: string, raw: Json, anchored: boolean): MapEntity {
  const scale = vec(raw.scale, { x: 1, y: 1 })
  return entity(level, {
    ...grouped(raw),
    toolId: "portal",
    layer: 500,
    position: im.p(vec(raw.position)),
    rotation: deg(num(raw.rotation, 0)),
    ...spriteScale(scale),
    params: { asset: im.asset(raw.texture), blockLight: bool(raw.closed, false), anchored },
  })
}

function walls(im: Importer, level: string, raw: Json): MapEntity[] {
  const out: MapEntity[] = []
  for (const w of arr(raw.walls).map(obj)) {
    const pts = tryParse(parsePoolVec2, w.points)?.map((q) => im.p(q)) ?? []
    if (pts.length < 2) continue
    out.push(
      entity(level, {
        toolId: "wall",
        ...grouped(w),
        layer: 600,
        points: pts,
        closed: bool(w.loop, false),
        position: pts[0],
        params: {
          wall: selection(im.asset(w.texture), argbToHex(w.color)),
          shadow: bool(w.shadow, true),
          bevelCorners: num(w.joint, 1) === 1,
        },
      }),
    )
    for (const p of arr(w.portals).map(obj)) out.push(portal(im, level, p, true))
  }
  for (const p of arr(raw.portals).map(obj)) out.push(portal(im, level, p, false))
  return out
}

/**
 * Floors: shape polygons, each filled with the tileset most of its cells
 * use, tinted with the color most of those cells have (Dungeondraft keeps a
 * color per cell, `tiles.colors`).
 */
function floors(im: Importer, level: string, raw: Json): MapEntity[] {
  const tiles = obj(raw.tiles)
  const cells = tryParse(parsePoolInt, tiles.cells ?? raw.tiles) ?? []
  const lookup = obj(tiles.lookup)
  const colors = arr(tiles.colors)
  const polygons = arr(obj(raw.shapes).polygons)
    .map((p) => tryParse(parsePoolVec2, p))
    .filter((p): p is Vec2[] => !!p && p.length > 2)
  const covered = new Set<number>()
  const out = polygons.map((poly) => {
    const counts = new Map<string, number>()
    /** Per tileset path: how many of its cells have each color. */
    const tints = new Map<string, Map<string, number>>()
    cells.forEach((tile, i) => {
      if (tile < 0) return
      const center = { x: ((i % im.width) + 0.5) * PX, y: (Math.floor(i / im.width) + 0.5) * PX }
      if (!pointInPolygon(center, poly)) return
      covered.add(i)
      const path = str(lookup[String(tile)])
      if (!path) return
      counts.set(path, (counts.get(path) ?? 0) + 1)
      const color = argbToHex(colors[i], "#ffffff")
      const byColor = tints.get(path) ?? new Map<string, number>()
      byColor.set(color, (byColor.get(color) ?? 0) + 1)
      tints.set(path, byColor)
    })
    const mostOf = <K>(m: Map<K, number> | undefined) =>
      m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined
    const best = mostOf(counts)
    const tint = mostOf(best ? tints.get(best) : undefined) ?? "#ffffff"
    const pts = poly.map((q) => im.p(q))
    return entity(level, {
      toolId: "build",
      layer: -200,
      points: pts,
      closed: true,
      params: { floor: selection(best ? im.asset(best) : undefined, tint), bevelCorners: true },
    })
  })
  const loose = cells.filter((tile, i) => tile >= 0 && !covered.has(i)).length
  if (loose > 0) im.warn("looseTiles", loose)
  return out
}

function patterns(im: Importer, level: string, raw: Json): MapEntity[] {
  return arr(raw.patterns)
    .map(obj)
    .flatMap((pt) => {
      const local = tryParse(parsePoolVec2, pt.points) ?? []
      if (local.length < 3) return []
      const pts = im
        .local(local, vec(pt.position), num(pt.shape_rotation, 0), vec(pt.scale, { x: 1, y: 1 }))
        .map((q) => im.p(q))
      return [
        entity(level, {
          toolId: "pattern",
          ...grouped(pt),
          layer: num(pt.layer, 100),
          points: pts,
          closed: true,
          // Dungeondraft lays the texture from the node's origin, not the map's.
          position: im.p(vec(pt.position)),
          params: {
            pattern: selection(im.asset(pt.texture)),
            customColor: argbToHex(pt.color),
            // The texture turns with its shape: the node's rotation plus the texture's own.
            rotation: wrapDeg(deg(num(pt.rotation, 0) + num(pt.shape_rotation, 0))),
            outline: bool(pt.outline, false),
          },
        }),
      ]
    })
}

function objects(im: Importer, level: string, raw: Json): MapEntity[] {
  return arr(raw.objects)
    .map(obj)
    .map((o) => {
      const scale = vec(o.scale, { x: 1, y: 1 })
      return entity(level, {
        ...grouped(o),
        toolId: "object",
        layer: num(o.layer, 100),
        position: im.p(vec(o.position)),
        rotation: deg(num(o.rotation, 0)),
        ...spriteScale(scale),
        params: {
          asset: im.asset(o.texture),
          color: o.custom_color === undefined ? "" : argbToHex(o.custom_color),
          shadow: bool(o.shadow, true),
          blockLight: bool(o.block_light, false),
        },
      })
    })
}

function paths(im: Importer, level: string, raw: Json): MapEntity[] {
  return arr(raw.paths)
    .map(obj)
    .flatMap((pa) => {
      const local = tryParse(parsePoolVec2, pa.edit_points) ?? []
      if (local.length < 2) return []
      const pts = im
        .local(local, vec(pa.position), num(pa.rotation, 0), vec(pa.scale, { x: 1, y: 1 }))
        .map((q) => im.p(q))
      const transition = (fade: unknown, grow: unknown) =>
        bool(fade, false) ? "fade" : bool(grow, false) ? "growth" : "none"
      return [
        entity(level, {
          toolId: "path",
          ...grouped(pa),
          layer: num(pa.layer, 100),
          points: pts,
          ...(bool(pa.loop, false) ? { closed: true } : {}),
          position: pts[0],
          params: {
            asset: im.asset(pa.texture),
            // Tiles for now: the Width multiplier needs the texture's
            // height (see pathWidthMultipliers).
            [PATH_WIDTH_TILES]: num(pa.width, PX) / PX,
            smoothness: num(pa.smoothness, 0),
            blockLight: bool(pa.block_light, false),
            transitionIn: transition(pa.fade_in, pa.grow),
            transitionOut: transition(pa.fade_out, pa.shrink),
          },
        }),
      ]
    })
}

/**
 * The map's building wear from `world.building_wear`: the texture path
 * Dungeondraft stores (empty/null = None), by its file name (dust, grime,
 * noise, scratched). A file of another name keeps the default grime.
 */
export function buildingWear(raw: unknown): BuildingWear {
  if (raw === undefined) return DEFAULT_BUILDING_WEAR
  if (typeof raw !== "string" || raw === "") return "none"
  const stem = raw
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
  return isBuildingWear(stem) ? stem : DEFAULT_BUILDING_WEAR
}

/** Param an imported path carries its width in tiles in, until pathWidthMultipliers converts it. */
export const PATH_WIDTH_TILES = "importedWidthTiles"

/**
 * Imported paths' widths as Width multipliers: Dungeondraft files store a
 * path's width in pixels, Open20 Battle Maps the multiplier of the
 * texture's height (as Dungeondraft's own Width setting), so it needs the
 * textures' heights in tiles (`heightOf`; a missing texture counts as 1).
 */
export function pathWidthMultipliers(
  entities: readonly MapEntity[],
  heightOf: (assetId: string) => number | undefined,
): MapEntity[] {
  return entities.map((e) => {
    const tiles = e.params[PATH_WIDTH_TILES]
    if (typeof tiles !== "number") return e
    const asset = typeof e.params.asset === "string" ? e.params.asset : ""
    const params: Record<string, unknown> = { ...e.params, width: tiles / (heightOf(asset) || 1) }
    delete params[PATH_WIDTH_TILES]
    return { ...e, params }
  })
}

function lights(im: Importer, level: string, raw: Json): MapEntity[] {
  return arr(raw.lights)
    .map(obj)
    .map((l) =>
      entity(level, {
        ...grouped(l),
        toolId: "light",
        layer: 700,
        position: im.p(vec(l.position)),
        rotation: deg(num(l.rotation, 0)),
        params: {
          range: num(l.range, 5),
          intensity: num(l.intensity, 1),
          color: argbToHex(l.color),
          shadow: bool(l.shadows, true),
          style: selection(im.asset(l.texture)),
        },
      }),
    )
}

const ROOF_TYPES = ["gable", "hip", "dormer"]

/**
 * Roofs. Dungeondraft stores the ridge line plus the eave distance; Open20 Battle Maps
 * roofs are outlines, so the outline is the ridge's bounds grown by the eave
 * width (hips also past the ridge ends).
 */
function roofs(im: Importer, level: string, raw: Json): MapEntity[] {
  const settings = obj(raw.roofs)
  return arr(settings.roofs)
    .map(obj)
    .flatMap((r) => {
      const local = tryParse(parsePoolVec2, r.points) ?? []
      if (local.length < 2) return []
      const ridge = im
        .local(local, vec(r.position), num(r.rotation, 0), vec(r.scale, { x: 1, y: 1 }))
        .map((q) => im.p(q))
      const type = ROOF_TYPES[num(r.type, 0)] ?? "gable"
      // Same model as Dungeondraft's: the ridge, and how far each eave is.
      return [
        entity(level, {
          toolId: "roof",
          ...grouped(r),
          layer: 800,
          points: ridge,
          position: ridge[0],
          params: {
            width: num(r.width, PX) / PX,
            style: selection(im.asset(r.texture)),
            type,
            shade: bool(settings.shade, true),
            sunDirection: num(settings.sun_direction, 45),
            shadeContrast: num(settings.shade_contrast, 0.5),
          },
        }),
      ]
    })
}

/**
 * Texts: one line from its top-left corner, as in Open20 Battle Maps. The
 * font_name stays as Dungeondraft wrote it ("Libre Baskerville Bold"): it's
 * resolved against the fonts catalog once the map is in (fonts/resolve.ts).
 */
function texts(im: Importer, level: string, raw: Json): MapEntity[] {
  return arr(raw.texts)
    .map(obj)
    .map((t) =>
      entity(level, {
        ...grouped(t),
        toolId: "text",
        layer: 900,
        // Screen-left is the larger map x (mirrored): the corner maps as is.
        position: im.p(vec(t.position)),
        text: (str(t.text) ?? "").replace(/\s*\n\s*/g, " "),
        params: {
          font: str(t.font_name) ?? "",
          fontSize: num(t.font_size, 32),
          fontColor: argbToHex(t.font_color, "#000000"),
          // Dungeondraft's box_shape: 0 none, 1 rectangle, 2 pill (fully rounded).
          box: num(t.box_shape, 0) === 1 || num(t.box_shape, 0) === 2,
          boxRadius: num(t.box_shape, 0) === 2 ? 100 : 0,
          boxBorderWidth: num(t.box_border_width, 2),
          boxColor: argbToHex(t.box_background_color, "#ffffff"),
          boxBorderColor: argbToHex(t.box_border_color, "#000000"),
        },
      }),
    )
}

function cave(im: Importer, level: string, raw: Json, cellPx: number): MapEntity[] {
  const c = obj(raw.cave)
  // One-cell stamps on Dungeondraft's own grid; the entrance bitmap is the
  // blasted-open area, kept apart from the dug one.
  const cell = stampRadius(1)
  const strokes = [
    ...bitmapStrokes(im, c.bitmap, cellPx, cell),
    ...bitmapStrokes(im, c.entrance_bitmap, cellPx, cell).map((s) => ({ ...s, blast: true })),
  ]
  if (strokes.length === 0) return []
  return [
    entity(level, {
      toolId: "cave",
      layer: -300,
      strokes,
      params: {
        groundColor: argbToHex(c.ground_color, "#7f7e71"),
        wallColor: argbToHex(c.wall_color, "#7f7e71"),
        style: selection(im.asset(c.texture)),
      },
    }),
  ]
}

function materials(im: Importer, level: string, raw: Json): MapEntity[] {
  const out: MapEntity[] = []
  for (const [layer, regions] of Object.entries(obj(raw.materials))) {
    for (const region of arr(regions).map(obj)) {
      // One-cell stamps on Dungeondraft's material grid (128 px cells).
      const strokes = bitmapStrokes(im, region.bitmap, 128, stampRadius(1, MATERIAL_CELLS_PER_TILE))
      if (strokes.length === 0) continue
      out.push(
        entity(level, {
          toolId: "material",
          layer: Number(layer) || -400,
          strokes,
          params: {
            material: selection(im.asset(region.texture)),
            smooth: bool(region.smooth, false),
          },
        }),
      )
    }
  }
  return out
}

/**
 * Terrain: Dungeondraft's splat (RGBA weights, 4 texels per cell; `splat2`
 * holds slots 5–8) carried over byte for byte as the level's terrain
 * (model/terrain.ts), which blends and paints exactly as Dungeondraft does.
 */
function terrain(im: Importer, level: string, raw: Json): MapEntity[] {
  const t = obj(raw.terrain)
  if (!str(t.texture_1)) return []
  const slots = Array.from({ length: TERRAIN_SLOTS }, (_, i) =>
    str(t[`texture_${i + 1}`]) ? (im.asset(t[`texture_${i + 1}`]) ?? null) : null,
  )
  const width = im.width * TEXELS_PER_TILE
  const height = im.height * TEXELS_PER_TILE
  const texels = width * height
  const splats = [tryParse(parsePoolBytes, t.splat), tryParse(parsePoolBytes, t.splat2)]
  // A map without a splat is all slot 1, Dungeondraft's default.
  const weights = splats[0]
    ? new Uint8Array(texels * TERRAIN_SLOTS)
    : filledWeights(width, height, 0)
  splats.forEach((bytes, half) => {
    if (!bytes) return
    for (let i = 0; i < texels; i++) {
      for (let c = 0; c < 4; c++) weights[i * TERRAIN_SLOTS + half * 4 + c] = bytes[i * 4 + c] ?? 0
    }
  })
  const data: TerrainData = { width, height, slots, weights: encodeWeights(weights) }
  return [
    entity(level, { toolId: "terrainBrush", layer: -500, strokes: [], params: { terrain: data } }),
  ]
}

/** The terrain brush setup a map was saved with (slots, blending, visibility). */
export interface TerrainSetup {
  /** Asset ids of texture slots 1..8 (null for empty slots). */
  slots: (string | null)[]
  expanded: boolean
  smoothBlending: boolean
  enabled: boolean
}

function terrainSetup(raw: Json): TerrainSetup | undefined {
  const t = obj(raw.terrain)
  if (!str(t.texture_1)) return undefined
  const expanded = bool(t.expand_slots, false)
  const count = expanded ? 8 : 4
  // Built-in textures still count: an unresolvable slot reads better than a shifted one.
  const slots = Array.from({ length: count }, (_, i) => {
    const res = str(t[`texture_${i + 1}`])
    return res ? resToAssetId(res) : null
  })
  return {
    slots,
    expanded,
    smoothBlending: bool(t.smooth_blending, false),
    enabled: bool(t.enabled, true),
  }
}

/** Water bodies: the polygon tree's odd-depth nodes (even depths are holes). */
function water(im: Importer, level: string, raw: Json): MapEntity[] {
  const wtr = obj(raw.water)
  const disableBorder = bool(wtr.disable_border, false)
  const out: MapEntity[] = []
  const walk = (node: Json, depth: number) => {
    const poly = tryParse(parsePoolVec2, node.polygon) ?? []
    if (poly.length > 2) {
      if (depth % 2 === 1) {
        const pts = poly.map((q) => im.p(q))
        out.push(
          entity(level, {
            toolId: "water",
            layer: 0,
            points: pts,
            closed: true,
            position: pts[0],
            params: {
              deepColor: argbToHex(node.deep_color ?? wtr.deep_color, "#3aa19a"),
              shallowColor: argbToHex(node.shallow_color ?? wtr.shallow_color, "#8bceb0"),
              blendDistance: num(node.blend_distance ?? wtr.blend_distance, 1.5),
              disableBorder,
            },
          }),
        )
      } else {
        im.warn("waterHoles")
      }
    }
    for (const child of arr(node.children).map(obj)) walk(child, depth + 1)
  }
  if (wtr.tree) walk(obj(wtr.tree), 0)
  return out
}

/** Convert a `.dungeondraft_map` JSON text into an Open20 Battle Maps document. */
/**
 * Whether `text` is a Dungeondraft map, by its content: it opens with its
 * "header" (an .otbm file opens with its "format"). Needed where the file's
 * name isn't known — Android's file picker hands over a content:// URI.
 */
export function looksLikeDungeondraftMap(text: string): boolean {
  return /^\s*\{\s*"header"\s*:/.test(text.slice(0, 64))
}

export function importDungeondraftMap(text: string): ImportResult {
  let data: Json
  try {
    data = obj(JSON.parse(text))
  } catch {
    throw new DungeondraftImportError("Invalid JSON")
  }
  const world = obj(data.world)
  const header = obj(data.header)
  const width = num(world.width, 0)
  const height = num(world.height, 0)
  if (!(width > 0 && height > 0) || !data.world) {
    throw new DungeondraftImportError("Not a Dungeondraft map")
  }
  const im = new Importer(width, height)
  const doc = createDocument(width, height)
  const cellPx = num(obj(world.msi).cell_size, 64)

  const levelKeys = Object.keys(obj(world.levels)).sort((a, b) => Number(a) - Number(b))
  const levels: MapLevel[] = []
  const entities: MapEntity[] = []
  let ambient: string | undefined
  for (const key of levelKeys) {
    const raw = obj(obj(world.levels)[key])
    const id = `dd-level-${key}`
    levels.push({ id, name: str(raw.label) ?? "" })
    const levelAmbient = argbToHex(obj(raw.environment).ambient_light, "#ffffff")
    if (ambient === undefined) ambient = levelAmbient
    else if (levelAmbient !== ambient) im.warn("levelAmbient")
    // Draw order inside a layer is document order: emit bottom-up.
    entities.push(
      ...terrain(im, id, raw),
      ...cave(im, id, raw, cellPx),
      ...floors(im, id, raw),
      ...materials(im, id, raw),
      ...water(im, id, raw),
      ...patterns(im, id, raw),
      ...paths(im, id, raw),
      ...objects(im, id, raw),
      ...walls(im, id, raw),
      ...lights(im, id, raw),
      ...roofs(im, id, raw),
      ...texts(im, id, raw),
    )
  }
  if (levels.length > 0) doc.levels = levels
  // Rooms (a floor and the wall around it) move and reshape together.
  doc.entities = linkRooms(entities)
  doc.environment = { ambientLight: ambient ?? "#ffffff" }
  doc.buildingWear = buildingWear(world.building_wear)

  const editor = obj(header.editor_state)
  const trace = obj(editor.trace_image)
  if (str(trace.image)) {
    // The image's pixel size isn't known until it loads; start at map width.
    im.warn("traceImageSize")
    doc.referenceImage = {
      path: str(trace.image) as string,
      opacity: num(trace.opacity, 0.5),
      visible: bool(world.trace_image_visible, true),
      position: { x: 0, y: vec(trace.position).y / PX },
      width,
    }
  }

  const manifest = arr(header.asset_manifest)
    .map((m) => str(obj(m).id))
    .filter((id): id is string => !!id)
  const packs = [...new Set([...manifest, ...im.packs])]
  const grid = str(obj(world.grid).color)
  const currentLevel = Math.max(0, Math.min(levels.length - 1, num(editor.current_level, 0)))
  return {
    doc,
    packs,
    gridColor: grid ? argbToHex(grid) : undefined,
    currentLevel,
    warnings: im.warnings,
    terrain: terrainSetup(obj(obj(world.levels)[levelKeys[currentLevel] ?? ""])),
  }
}
