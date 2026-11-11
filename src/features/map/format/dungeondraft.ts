import { boundsOf, newId, pointInPolygon, rotateAround, textSize } from "../model/geometry"
import {
  createDocument,
  type BrushStroke,
  type MapDocument,
  type MapEntity,
  type MapLevel,
  type Vec2,
} from "../model/types"
import { argbToHex, parsePoolBytes, parsePoolInt, parsePoolVec2, parseVec2 } from "./godot"

/**
 * Importer for Dungeondraft maps (`.dungeondraft_map`, save format 3) into
 * the OpenDraft document model. Field semantics follow the format notes in
 * docs/dungeondraft-map-format.md (reconstructed for interoperability).
 *
 * Coordinates: Dungeondraft uses 256 world px per grid cell with x growing to
 * the right; OpenDraft map space is in cells with x mirrored (0 at the right
 * edge), so `x' = width − x/256`, `y' = y/256`. Angles stay screen-clockwise
 * (radians → degrees).
 *
 * Bitmap areas (caves, materials, terrain splats) become brush strokes, one
 * per horizontal run of set samples. Anything OpenDraft can't represent is
 * reported as a warning instead of being silently dropped.
 */

/** Dungeondraft world px per grid cell. */
const PX = 256

export type ImportWarningKey =
  | "mirroredObjects"
  | "builtinAssets"
  | "embeddedAssets"
  | "waterHoles"
  | "looseTiles"
  | "levelAmbient"
  | "pathLoops"
  | "traceImageSize"

export interface ImportResult {
  doc: MapDocument
  /** Pack ids the map's asset manifest lists. */
  packs: string[]
  /** Grid line color (Map Settings), when the map sets one. */
  gridColor?: string
  /** Index into `doc.levels` of the level the map was last edited on. */
  currentLevel: number
  /** Features OpenDraft couldn't carry over, with how many times each occurred. */
  warnings: Partial<Record<ImportWarningKey, number>>
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

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  warn(key: ImportWarningKey, count = 1): void {
    this.warnings[key] = (this.warnings[key] ?? 0) + count
  }

  /** Dungeondraft world px → OpenDraft map tiles. */
  p(v: Vec2): Vec2 {
    return { x: this.width - v.x / PX, y: v.y / PX }
  }

  /**
   * Texture resource path → library asset id. Pack assets live under
   * `res://packs/<id>/…`; anything else is Dungeondraft's built-in library
   * (not available outside Dungeondraft) or an embedded image.
   */
  asset(res: unknown): string | undefined {
    const path = str(res)
    if (!path) return undefined
    const m = /^res:\/\/packs\/([^/]+)\/(.+)$/.exec(path)
    if (m) return `${m[1]}|${m[2]}`
    if (path.startsWith("embedded://")) this.warn("embeddedAssets")
    else this.warn("builtinAssets")
    return `dungeondraft|${path.replace(/^res:\/\//, "")}`
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
function bitmapStrokes(im: Importer, literal: unknown, cellPx: number): BrushStroke[] {
  const bytes = tryParse(parsePoolBytes, literal)
  if (!bytes) return []
  const gridW = Math.round((im.width * PX) / cellPx) + 3
  const gridH = Math.round((im.height * PX) / cellPx) + 3
  const radius = (cellPx / PX) * 0.75
  return bitmapRuns(bytes, gridW, gridH).map(([y, x0, x1]) => ({
    points: [
      im.p({ x: (x0 - 1) * cellPx, y: (y - 1) * cellPx }),
      im.p({ x: (x1 - 1) * cellPx, y: (y - 1) * cellPx }),
    ],
    radius,
  }))
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

function portal(im: Importer, level: string, raw: Json, anchored: boolean): MapEntity {
  const scale = vec(raw.scale, { x: 1, y: 1 })
  return entity(level, {
    toolId: "portal",
    layer: 500,
    position: im.p(vec(raw.position)),
    rotation: deg(num(raw.rotation, 0)),
    scale: Math.abs(scale.x) || 1,
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

/** Floors: shape polygons, each filled with the tileset most of its cells use. */
function floors(im: Importer, level: string, raw: Json): MapEntity[] {
  const tiles = obj(raw.tiles)
  const cells = tryParse(parsePoolInt, tiles.cells ?? raw.tiles) ?? []
  const lookup = obj(tiles.lookup)
  const polygons = arr(obj(raw.shapes).polygons)
    .map((p) => tryParse(parsePoolVec2, p))
    .filter((p): p is Vec2[] => !!p && p.length > 2)
  const covered = new Set<number>()
  const out = polygons.map((poly) => {
    const counts = new Map<string, number>()
    cells.forEach((tile, i) => {
      if (tile < 0) return
      const center = { x: ((i % im.width) + 0.5) * PX, y: (Math.floor(i / im.width) + 0.5) * PX }
      if (!pointInPolygon(center, poly)) return
      covered.add(i)
      const path = str(lookup[String(tile)])
      if (path) counts.set(path, (counts.get(path) ?? 0) + 1)
    })
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const pts = poly.map((q) => im.p(q))
    return entity(level, {
      toolId: "build",
      layer: -200,
      points: pts,
      closed: true,
      position: pts[0],
      params: { floor: selection(best ? im.asset(best) : undefined), bevelCorners: true },
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
          layer: num(pt.layer, 100),
          points: pts,
          closed: true,
          position: pts[0],
          params: {
            pattern: selection(im.asset(pt.texture)),
            customColor: argbToHex(pt.color),
            rotation: deg(num(pt.rotation, 0)),
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
      if (bool(o.mirror, false) || scale.x < 0) im.warn("mirroredObjects")
      return entity(level, {
        toolId: "object",
        layer: num(o.layer, 100),
        position: im.p(vec(o.position)),
        rotation: deg(num(o.rotation, 0)),
        scale: Math.abs(scale.y) || 1,
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
      let pts = im
        .local(local, vec(pa.position), num(pa.rotation, 0), vec(pa.scale, { x: 1, y: 1 }))
        .map((q) => im.p(q))
      if (bool(pa.loop, false)) {
        // OpenDraft paths are open: close the loop by returning to the start.
        im.warn("pathLoops")
        pts = [...pts, pts[0]]
      }
      const transition = (fade: unknown, grow: unknown) =>
        bool(fade, false) ? "fade" : bool(grow, false) ? "growth" : "none"
      return [
        entity(level, {
          toolId: "path",
          layer: num(pa.layer, 100),
          points: pts,
          position: pts[0],
          params: {
            asset: im.asset(pa.texture),
            width: num(pa.width, PX) / PX,
            smoothness: num(pa.smoothness, 0),
            blockLight: bool(pa.block_light, false),
            transitionIn: transition(pa.fade_in, pa.grow),
            transitionOut: transition(pa.fade_out, pa.shrink),
          },
        }),
      ]
    })
}

function lights(im: Importer, level: string, raw: Json): MapEntity[] {
  return arr(raw.lights)
    .map(obj)
    .map((l) =>
      entity(level, {
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
 * Roofs. Dungeondraft stores the ridge line plus the eave distance; OpenDraft
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
      const eave = num(r.width, PX) / PX
      const b = boundsOf(ridge)
      const alongX = b.w >= b.h
      const grow = {
        x: alongX ? (type === "hip" ? eave : 0) : eave,
        y: alongX ? eave : type === "hip" ? eave : 0,
      }
      const outline = [
        { x: b.x - grow.x, y: b.y - grow.y },
        { x: b.x + b.w + grow.x, y: b.y - grow.y },
        { x: b.x + b.w + grow.x, y: b.y + b.h + grow.y },
        { x: b.x - grow.x, y: b.y + b.h + grow.y },
      ]
      return [
        entity(level, {
          toolId: "roof",
          layer: 800,
          points: outline,
          closed: true,
          position: outline[0],
          params: {
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

/** Texts: Dungeondraft anchors the top-left corner; OpenDraft the center. */
function texts(im: Importer, level: string, raw: Json): MapEntity[] {
  return arr(raw.texts)
    .map(obj)
    .map((t) => {
      const e = entity(level, {
        toolId: "text",
        layer: 900,
        text: str(t.text) ?? "",
        params: {
          font: str(t.font_name) ?? "",
          fontSize: num(t.font_size, 32),
          fontColor: argbToHex(t.font_color, "#000000"),
          sharpenFonts: true,
          textBox: num(t.box_shape, 0) !== 0,
        },
      })
      const size = textSize(e)
      // Screen-left is the larger map x (mirrored).
      const topLeft = im.p(vec(t.position))
      return { ...e, position: { x: topLeft.x - size.w / 2, y: topLeft.y + size.h / 2 } }
    })
}

function cave(im: Importer, level: string, raw: Json, cellPx: number): MapEntity[] {
  const c = obj(raw.cave)
  const strokes = [
    ...bitmapStrokes(im, c.bitmap, cellPx),
    ...bitmapStrokes(im, c.entrance_bitmap, cellPx),
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
      const strokes = bitmapStrokes(im, region.bitmap, 128)
      if (strokes.length === 0) continue
      out.push(
        entity(level, {
          toolId: "material",
          layer: Number(layer) || -400,
          strokes,
          params: { material: selection(im.asset(region.texture)) },
        }),
      )
    }
  }
  return out
}

/**
 * Terrain splat (RGBA weights, 4 texels per cell): texture 1 becomes the
 * base (a Fill), and every other texture is painted where its weight wins
 * the texel. Partial blends are approximated by that majority.
 */
function terrain(im: Importer, level: string, raw: Json): MapEntity[] {
  const t = obj(raw.terrain)
  const tex = (i: number) => (str(t[`texture_${i}`]) ? im.asset(t[`texture_${i}`]) : undefined)
  const base = tex(1)
  if (!base) return []
  const out: MapEntity[] = [
    entity(level, {
      toolId: "terrainBrush",
      layer: -500,
      strokes: [],
      params: { texture: base, base, fill: true },
    }),
  ]
  const w = im.width * 4
  const h = im.height * 4
  const splats = [tryParse(parsePoolBytes, t.splat), tryParse(parsePoolBytes, t.splat2)]
  splats.forEach((bytes, splatIndex) => {
    if (!bytes) return
    for (let channel = 0; channel < 4; channel++) {
      const slot = splatIndex * 4 + channel + 1
      const texture = tex(slot)
      if (!texture || slot === 1) continue
      const strokes: BrushStroke[] = []
      for (let y = 0; y < h; y++) {
        let start = -1
        for (let x = 0; x <= w; x++) {
          const at = (y * w + x) * 4
          const on = x < w && (bytes[at + channel] ?? 0) >= 128
          if (on && start < 0) start = x
          if (!on && start >= 0) {
            // texel = world/64 + 0.5, so texel t's center sits at world t × 64.
            strokes.push({
              points: [im.p({ x: start * 64, y: y * 64 }), im.p({ x: (x - 1) * 64, y: y * 64 })],
              radius: 0.18,
            })
            start = -1
          }
        }
      }
      if (strokes.length === 0) continue
      out.push(
        entity(level, {
          toolId: "terrainBrush",
          layer: -500,
          strokes,
          params: { texture, base, intensity: 8, smoothBlending: true },
        }),
      )
    }
  })
  return out
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

/** Convert a `.dungeondraft_map` JSON text into an OpenDraft document. */
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
  doc.entities = entities
  doc.environment = { ambientLight: ambient ?? "#ffffff" }

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

  const packs = arr(header.asset_manifest)
    .map((m) => str(obj(m).id))
    .filter((id): id is string => !!id)
  const grid = str(obj(world.grid).color)
  return {
    doc,
    packs,
    gridColor: grid ? argbToHex(grid) : undefined,
    currentLevel: Math.max(0, Math.min(levels.length - 1, num(editor.current_level, 0))),
    warnings: im.warnings,
  }
}
