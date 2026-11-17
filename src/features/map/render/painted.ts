import { wearOverlay } from "./buildingWear"
import {
  BufferImageSource,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  Texture,
  TilingSprite,
  type Renderer,
} from "pixi.js"
import { hexToPixiColor } from "../../../lib/colors"
import { type MapEntity, type Vec2 } from "../model/types"
import { TEXTURE_PX_PER_TILE } from "./assets"
import { lineMesh, type RenderEnv, selectionAsset } from "./entities"
import {
  CELLS_PER_TILE,
  MATERIAL_CELLS_PER_TILE,
  cellsToMap,
  emptyGrid,
  gridField,
  stampStroke,
  type CellGrid,
} from "./cells"
import {
  caveJitter,
  clipOutside,
  distanceField,
  holeLoops,
  isoContours,
  rampAt,
  simplifyLoop,
  waterRamp,
} from "./fields"
import { wallTriangles } from "./lineGeometry"
import { WaterFilter } from "./waterFilter"
import { waterPolygons } from "./waterGeometry"
import { waterInkTexture, waterRippleTexture } from "./generated"
import { paperTint, WATER_INK, waterPixel } from "./waterStyle"
import { LayerMaskFilter } from "./layerFilter"
import { type TerrainData } from "../model/terrain"
import { liveTerrain, weightsOf } from "../terrainLive"
import { packWeights, type TexelRect } from "./splat"
import { TerrainLayer } from "./terrainMesh"
import { takeLiveDirty } from "../terrainLive"

/**
 * Painted layers (Cave, Water, Terrain Brush, Material): every stroke of a
 * tool on the active level is composited, in document order, into a mask
 * render texture covering the map; the visible fill is a tiling texture (or
 * flat color) masked by it. One composite per tool keeps the draw cost flat no
 * matter how many strokes were painted.
 */

export interface Composite {
  view: Container
  dispose: () => void
  /** Re-read live data in place (terrain while a stroke is painted). */
  refresh?: () => void
  /** Update screen caches before the screen is rendered. */
  prerender?: () => void
  /** Draw for an export (true) or the screen (false). */
  setDirect?: (on: boolean) => void
}

export interface MapBox {
  width: number
  height: number
}

/**
 * Mask resolution (px per tile). Each painted texture keeps one mask the
 * size of the map, so the longest side is held to MASK_MAX_PX (16 MB of GPU
 * memory per mask at most): coverage is soft and filtered, it doesn't need
 * the textures' detail.
 */
const MASK_MAX_PX = 2048
export function maskResolution(map: MapBox): number {
  return Math.max(4, Math.min(32, Math.floor(MASK_MAX_PX / Math.max(map.width, map.height))))
}

/** A map-sized render target plus the container transform to draw into it in content space. */
class MapMask {
  readonly rt: RenderTexture
  readonly res: number

  constructor(
    private renderer: Renderer,
    private map: MapBox,
    /** Px per tile (default: as fine as the map's size allows, maskResolution). */
    res?: number,
  ) {
    this.res = res ?? maskResolution(map)
    this.rt = RenderTexture.create({ width: map.width * this.res, height: map.height * this.res })
  }

  /** Render `children` (content-space coords) into the mask. */
  draw(children: Container[], clear: boolean): void {
    const stage = new Container()
    stage.scale.set(this.res)
    stage.position.set(this.map.width * this.res, 0)
    // addChild() with no arguments throws: clearing passes an empty list.
    if (children.length > 0) stage.addChild(...children)
    this.renderer.render({ container: stage, target: this.rt, clear })
    stage.destroy({ children: true })
  }

  /** A sprite showing the mask, laid over the map in content space. */
  sprite(): Sprite {
    const s = new Sprite(this.rt)
    s.position.set(-this.map.width, 0)
    s.scale.set(1 / this.res)
    return s
  }

  destroy(): void {
    this.rt.destroy(true)
  }
}

/** A map-covering fill: tiling texture when available, else a flat color. */
function mapFill(map: MapBox, texture: Texture | undefined, tint: string | undefined): Container {
  if (texture) {
    texture.source.style.addressMode = "repeat"
    const t = new TilingSprite({ texture, width: map.width, height: map.height })
    t.position.set(-map.width, 0)
    t.tileScale.set(1 / TEXTURE_PX_PER_TILE)
    if (tint) t.tint = hexToPixiColor(tint).color
    return t
  }
  const s = new Sprite(Texture.WHITE)
  s.position.set(-map.width, 0)
  s.width = map.width
  s.height = map.height
  s.tint = hexToPixiColor(tint ?? "#ffffff").color
  return s
}

/**
 * `fill` showing only where `mask` (a coverage sprite) covers, in one
 * screen-clipped filter pass (see layerFilter.ts).
 */
function masked(fill: Container, mask: Sprite): Container {
  const c = new Container()
  // The mask sprite only needs its transform (the filter samples its texture).
  mask.renderable = false
  c.addChild(fill, mask)
  const filter = new LayerMaskFilter(mask)
  fill.filters = [filter]
  c.once("destroyed", () => filter.destroy())
  return c
}

const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback)
const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback)

/** Cave ground and wall color when none is set (Dungeondraft's 7f7e71). */
const CAVE_DEFAULT_COLOR = "#7f7e71"

/** Bundle a composite's view with the masks it owns, freeing both together. */
function composite(view: Container, masks: Iterable<MapMask>): Composite {
  const owned = [...masks]
  return {
    view,
    dispose: () => {
      view.destroy({ children: true })
      for (const m of owned) m.destroy()
    },
  }
}

/** A texture fill, or the flat `color` while the texture is loading/unset. */
function textureOrColor(map: MapBox, texture: Texture | undefined, color: string): Container {
  return mapFill(map, texture, texture ? undefined : color)
}

function caveComposite(
  entities: MapEntity[],
  map: MapBox,
  renderer: Renderer,
  env: RenderEnv,
): Composite {
  const last = entities[entities.length - 1]
  const { id } = selectionAsset(last.params.style)
  const ground = str(last.params.groundColor, CAVE_DEFAULT_COLOR)
  const wallColor = str(last.params.wallColor, CAVE_DEFAULT_COLOR)
  const view = new Container()

  // Dungeondraft's two cave bitmaps (quarter-tile cells): dug, and blasted
  // open (its entrance bitmap), each painted stroke by stroke in order.
  const dug = emptyGrid(map.width, map.height)
  const blasted = emptyGrid(map.width, map.height)
  for (const e of entities) {
    for (const s of e.strokes ?? []) stampStroke(s.blast ? blasted : dug, s, s.erase ? 0 : 1)
  }
  /** Outlines of a grid: marching squares cut at half edges, every vertex jittered. */
  const outlines = (grid: CellGrid) =>
    isoContours(gridField(grid), grid.w, grid.h, 0.5).map((loop) =>
      loop.map((p) => cellsToMap(grid, p, caveJitter)),
    )
  const loops = outlines(dug)
  if (loops.length === 0) return composite(view, [])
  const blastLoops = outlines(blasted)

  // The floor: outlines filled, holes cut out; where blasted, faded out
  // (Dungeondraft lowers the floor's vertex alpha by 0.25 per blasted corner).
  const holes = holeLoops(loops)
  const shape = (loop: Vec2[], hole: boolean) => {
    const g = new Graphics()
      .poly(
        loop.flatMap((p) => [-p.x, p.y]),
        true,
      )
      .fill({ color: 0xffffff })
    if (hole) g.blendMode = "erase"
    return g
  }
  const fade = blastFade(blasted)
  const floor = new MapMask(renderer, map)
  floor.draw(
    [
      ...loops.flatMap((l, i) => (holes[i] ? [] : [shape(l, false)])),
      ...loops.flatMap((l, i) => (holes[i] ? [shape(l, true)] : [])),
      ...(fade ? [fade.sprite] : []),
    ],
    true,
  )
  fade?.texture.destroy(true)

  // The map's building wear multiplies over the cave's floor (and walls).
  const wear = env.buildingWear()
  const worn = (fill: Container): Container => {
    if (!wear) return fill
    const c = new Container()
    c.addChild(fill, wearOverlay(wear, -map.width, 0, map.width, map.height))
    return c
  }
  // The floor texture, 1:1 in px, multiplied by the ground color when the
  // style is colorable (Dungeondraft's Cave shader); flat color without one.
  const floorTex = env.tex(id)
  const fill = textureOrColor(map, floorTex, ground)
  if (floorTex && env.colorable(id)) fill.tint = hexToPixiColor(ground).color
  view.addChild(masked(worn(fill), floor.sprite()))

  // The walls: Dungeondraft's cave walls are wall lines along the outline —
  // the style's wall texture as wide as it's tall, sharp corners, no
  // normalize_uv or end caps — in the wall color, with the wear; cut open
  // (left as open lines) where the cave is blasted.
  const runs = loops.flatMap((loop) => clipOutside(loop, true, blastLoops))
  const wallTex = env.tex(id, { part: "wall" })
  if (wallTex) {
    const width = wallTex.height / TEXTURE_PX_PER_TILE
    const tint = hexToPixiColor(wallColor).color
    for (const run of runs) {
      const tris = wallTriangles(run, false, width, { bevel: false, normalizeUv: false })
      view.addChild(
        lineMesh(tris, width * (wallTex.width / wallTex.height), wallTex, 0, tint, wear),
      )
    }
  } else {
    const g = new Graphics()
    for (const run of runs)
      g.poly(
        run.flatMap((p) => [-p.x, p.y]),
        false,
      )
    g.stroke({ width: 0.3, color: hexToPixiColor(wallColor).color, join: "miter" })
    view.addChild(g)
  }
  // "Show blast opened area": the blasted area over the cave, editor only.
  if (env.showCaveBlast && blastLoops.length > 0) {
    const g = new Graphics()
    const blastHoles = holeLoops(blastLoops)
    blastLoops.forEach((l, i) => {
      g.poly(
        l.flatMap((p) => [-p.x, p.y]),
        true,
      )
      if (blastHoles[i]) g.cut()
      else g.fill({ color: BLAST_OVERLAY_COLOR, alpha: 0.35 })
    })
    view.addChild(g)
  }
  return composite(view, [floor])
}

/** The blasted area's overlay color (Show blast opened area). */
const BLAST_OVERLAY_COLOR = 0xe0534e

/**
 * How much of the cave floor each cell loses where it's blasted: a cell-grid
 * texture (alpha 1 where blasted), linearly filtered so the floor fades
 * across a cell at the blast's edge, drawn erasing the floor mask.
 */
function blastFade(blasted: CellGrid): { sprite: Sprite; texture: Texture } | null {
  if (!blasted.cells.some((v) => v !== 0)) return null
  const rgba = new Uint8Array(blasted.w * blasted.h * 4)
  blasted.cells.forEach((v, k) => {
    const a = v ? 255 : 0
    rgba.set([a, a, a, a], k * 4)
  })
  const texture = new Texture({
    source: new BufferImageSource({
      resource: rgba,
      width: blasted.w,
      height: blasted.h,
      alphaMode: "premultiplied-alpha",
      scaleMode: "linear",
    }),
  })
  const sprite = new Sprite(texture)
  // Cell grid → content space (x mirrored): the grid's right edge at x = 0.
  sprite.scale.set(-1 / CELLS_PER_TILE, 1 / CELLS_PER_TILE)
  sprite.position.set(0, 0)
  sprite.blendMode = "erase"
  return { sprite, texture }
}

/**
 * Water's ink line and ripple strokes: the meshes' widths in tiles (the ink
 * covers ~40–60 % of its mesh, ~9–14 px at 256 px per tile like the pack's
 * outlines), and how far inside the shore each ripple row runs.
 */
const WATER_INK_WIDTH = 22 / 256
const WATER_RIPPLE_WIDTH = 10 / 256
const WATER_RIPPLE_ROWS = [0.375, 0.85] as const
/** Ripple strokes: the water's color lightened toward paper, slightly see-through. */
const WATER_RIPPLE_TINT = 0.6
const WATER_RIPPLE_ALPHA = 0.85

/** A hex color's channels (0–255). */
function rgbOf(hex: string): [number, number, number] {
  const c = hexToPixiColor(hex).color
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]
}

/**
 * Water: Dungeondraft's model (its WaterMesh and Water.shader — the water's
 * polygons (waterGeometry.ts) filled from shallow at the shore to deep by
 * inner rings up to Blend Distance (waterRamp), the dark parts of what's
 * beneath showing through (waterFilter.ts)) drawn in the built-in pack's
 * hand-inked style (waterStyle.ts): the fill mottled like watercolor and
 * washed darker just inside the shore; unless the border is off, an ink
 * line of varying weight on every outline (holes too) and two rows of loose
 * light ripple strokes inside it, all with round corners.
 *
 * The ring colors come from a distance field over the polygons' raster —
 * Euclidean where Dungeondraft offsets with square joins — clipped to the
 * exact polygons; the ripples run along that field's iso-lines (round
 * inward offsets).
 */
function waterComposite(entities: MapEntity[], map: MapBox, renderer: Renderer): Composite {
  const last = entities[entities.length - 1]
  const deep = rgbOf(str(last.params.deepColor, "#3aa19a"))
  const shallow = rgbOf(str(last.params.shallowColor, "#8bceb0"))
  const ramp = waterRamp(num(last.params.blendDistance, 1.5))
  const view = new Container()
  const polys = waterPolygons(entities)
  if (polys.length === 0) return composite(view, [])

  /** The polygons as a filled shape, holes cut out (content space). */
  const filled = () => {
    const g = new Graphics()
    for (const { outer, holes } of polys) {
      g.poly(
        outer.flatMap((p) => [-p.x, p.y]),
        true,
      ).fill({ color: 0xffffff })
      for (const hole of holes)
        g.poly(
          hole.flatMap((p) => [-p.x, p.y]),
          true,
        ).cut()
    }
    return g
  }
  const area = new MapMask(renderer, map)
  area.draw([filled()], true)
  const res = area.res
  const { pixels, width: W, height: H } = renderer.extract.pixels({ target: area.rt })
  area.destroy()
  // Work only where the water is (plus a margin for the outlines).
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (pixels[(y * W + x) * 4 + 3] > 0) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
  }
  if (x1 < 0) return composite(view, [])
  x0 = Math.max(0, x0 - 2)
  y0 = Math.max(0, y0 - 2)
  x1 = Math.min(W - 1, x1 + 2)
  y1 = Math.min(H - 1, y1 + 2)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const inside = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      inside[y * w + x] = pixels[((y + y0) * W + x + x0) * 4 + 3] > 0 ? 1 : 0
    }
  }
  const dist = distanceField(inside, w, h)

  // The body: each pixel its ring color, clipped to the exact polygons.
  const colorAt = (tiles: number) => {
    const t = rampAt(ramp, tiles)
    return [0, 1, 2].map((c) => shallow[c] + (deep[c] - shallow[c]) * t) as [number, number, number]
  }
  const body = new Uint8Array(w * h * 4)
  for (let k = 0; k < w * h; k++) {
    if (!inside[k]) continue
    const tiles = dist[k] / res
    // The mottle is anchored to map coordinates, so it holds still as the
    // water is painted around it.
    const mx = map.width - ((k % w) + x0 + 0.5) / res
    const my = (Math.floor(k / w) + y0 + 0.5) / res
    body.set([...waterPixel(colorAt(tiles), tiles, mx, my), 255], k * 4)
  }
  const texture = new Texture({
    source: new BufferImageSource({
      resource: body,
      width: w,
      height: h,
      alphaMode: "premultiplied-alpha",
    }),
  })
  const sprite = new Sprite(texture)
  // Mask pixel (px, py) is content (−map.width + px/res, py/res).
  sprite.position.set(-map.width + x0 / res, y0 / res)
  sprite.scale.set(1 / res)
  const filter = new WaterFilter()
  sprite.filters = [filter]
  const clip = filled()
  sprite.mask = clip
  view.addChild(sprite, clip)

  if (last.params.disableBorder !== true) {
    const line = (loops: Vec2[][], tex: Texture, width: number, color: number, alpha = 1) => {
      for (const loop of loops) {
        if (loop.length < 3) continue
        const tris = wallTriangles(loop, true, width, {
          bevel: true,
          normalizeUv: false,
          round: true,
        })
        const mesh = lineMesh(tris, width * (tex.width / tex.height), tex, 0xffffff, color)
        mesh.alpha = alpha
        view.addChild(mesh)
      }
    }
    // The ripples: the shore offset inward with round corners (the distance
    // field's iso-lines), in map space.
    WATER_RIPPLE_ROWS.forEach((inset, row) => {
      const loops = isoContours(dist, w, h, inset * res).map((loop) =>
        simplifyLoop(loop, 0.35).map((p) => ({
          x: map.width - (p.x + x0) / res,
          y: (p.y + y0) / res,
        })),
      )
      const tint = paperTint(colorAt(inset), WATER_RIPPLE_TINT)
      line(
        loops,
        waterRippleTexture(row === 0 ? 0 : 1),
        WATER_RIPPLE_WIDTH,
        tint,
        WATER_RIPPLE_ALPHA,
      )
    })
    line(
      polys.flatMap((p) => [p.outer, ...p.holes]),
      waterInkTexture(),
      WATER_INK_WIDTH,
      WATER_INK,
    )
  }
  const comp = composite(view, [])
  return {
    ...comp,
    dispose: () => {
      comp.dispose()
      filter.destroy()
      texture.destroy(true)
    },
  }
}

/**
 * Terrain: one splat per level (slot weights, 4 texels per tile — see
 * model/terrain.ts), blended in one pass by Dungeondraft's formula
 * (terrainMesh.ts). The weights are packed three slots per RGB texture,
 * filtered bilinearly like Dungeondraft's splat; while a stroke is being
 * painted they're re-packed from the live buffer on every tick (refresh).
 */
function terrainComposite(
  entities: MapEntity[],
  map: MapBox,
  renderer: Renderer,
  env: RenderEnv,
): Composite {
  const entity = [...entities].reverse().find((e) => e.params.terrain)
  if (!entity) {
    const view = new Container()
    return { view, dispose: () => view.destroy() }
  }
  const data = entity.params.terrain as TerrainData
  const sources = [0, 1, 2].map(
    () =>
      new BufferImageSource({
        resource: new Uint8Array(data.width * data.height * 4),
        width: data.width,
        height: data.height,
        scaleMode: "linear",
        // Packed bytes are the weights themselves (alpha 255): no premultiplying.
        alphaMode: "premultiplied-alpha",
      }),
  )
  const pack = (rect?: TexelRect) => {
    packWeights(
      liveTerrain(entity.id) ?? weightsOf(data),
      sources.map((src) => src.resource as Uint8Array),
      data.width,
      rect,
    )
    for (const src of sources) src.update()
  }
  pack()
  const [w0, w1, w2] = sources.map((source) => new Texture({ source }))
  const weights: [Texture, Texture, Texture] = [w0, w1, w2]
  const layer = new TerrainLayer(
    renderer,
    {
      textures: data.slots.map((id) => (id ? env.tex(id) : undefined)),
      weights,
      smooth: env.terrainSmooth,
      map,
    },
    data,
  )
  return {
    view: layer.view,
    dispose: () => {
      layer.destroy()
      for (const t of weights) t.destroy(true)
    },
    // A stroke painted: re-pack and redraw just what it touched.
    refresh: () => {
      const rect = takeLiveDirty() ?? undefined
      pack(rect)
      layer.invalidate(rect)
    },
    prerender: () => layer.prerender(),
    setDirect: (on) => layer.setDirect(on),
  }
}

/** Signed area of a loop (map space). */
function signedArea(loop: readonly Vec2[]): number {
  let a = 0
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    a += (loop[j].x - loop[i].x) * (loop[j].y + loop[i].y)
  }
  return a / 2
}

/**
 * Dungeondraft's Smooth for material borders (LineSmoothing.SmoothLineChaikin,
 * one pass, closed): every corner cut at a quarter of its two edges.
 */
export function chaikinLoop(loop: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]
    const q = loop[(i + 1) % loop.length]
    out.push(
      { x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 },
      { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 },
    )
  }
  return out
}

/**
 * A material's border texture: Dungeondraft swaps "_tile" for "_border" in
 * the tile texture's file name (grass_tile_1 → grass_border_1). A material
 * whose name has no "_tile" has no border of its own.
 */
export function materialBorderPart(assetId: string): string | undefined {
  const stem = assetId.replace(/^.*[\\/|]/, "").replace(/\.[^.]+$/, "")
  return stem.includes("_tile") ? stem.replace("_tile", "_border") : undefined
}

/**
 * Material outlines of a cell grid: marching squares cut at half edges, the
 * vertices jittered half as much as a cave's (Dungeondraft's OffsetScale 0.5
 * on the same offset table), oriented so the material always lies on the
 * same side of the line (outer loops one way, holes the other).
 */
export function materialLoops(grid: CellGrid): Vec2[][] {
  const loops = isoContours(gridField(grid), grid.w, grid.h, 0.5).map((loop) =>
    loop.map((p) => cellsToMap(grid, p, (q) => caveJitter(q, 0.1))),
  )
  const holes = holeLoops(loops)
  return loops.map((loop, i) => {
    const wantPositive = holes[i]
    return signedArea(loop) > 0 === wantPositive ? loop : [...loop].reverse()
  })
}

/**
 * A layer's materials in draw order, each with its strokes' entities: in the
 * order they were first painted, except that a stroke painted with Move to
 * Front (`toFront`) moves its material over the others from then on.
 */
export function materialOrder(entities: readonly MapEntity[]): [string, MapEntity[]][] {
  const byMaterial = new Map<string, MapEntity[]>()
  for (const e of entities) {
    const key = selectionAsset(e.params.material).id ?? ""
    const list = byMaterial.get(key) ?? []
    list.push(e)
    if (e.params.toFront === true) byMaterial.delete(key)
    byMaterial.set(key, list)
  }
  return [...byMaterial]
}

/**
 * Material brush, as Dungeondraft's MaterialMesh: each material texture of a
 * layer is a bitmap of 128 px cells (stamped stroke by stroke, erasing
 * strokes clearing only their own material), filled with its tile texture
 * where marching squares cover it and bordered by its border texture — a
 * line as wide as the texture is tall, sharp corners, tiled, no color —
 * along every outline, smoothed when the material's Smooth is on. Materials
 * draw in materialOrder.
 */
function materialComposite(
  entities: MapEntity[],
  map: MapBox,
  renderer: Renderer,
  env: RenderEnv,
): Composite {
  const view = new Container()
  const masks: MapMask[] = []
  for (const [id, mine] of materialOrder(entities)) {
    const grid = emptyGrid(map.width, map.height, MATERIAL_CELLS_PER_TILE)
    for (const e of mine) for (const s of e.strokes ?? []) stampStroke(grid, s, s.erase ? 0 : 1)
    const loops = materialLoops(grid)
    if (loops.length === 0) continue
    const holes = holeLoops(loops)
    const shape = (loop: Vec2[], hole: boolean) => {
      const g = new Graphics()
        .poly(
          loop.flatMap((p) => [-p.x, p.y]),
          true,
        )
        .fill({ color: 0xffffff })
      if (hole) g.blendMode = "erase"
      return g
    }
    const area = new MapMask(renderer, map)
    area.draw(
      [
        ...loops.flatMap((l, i) => (holes[i] ? [] : [shape(l, false)])),
        ...loops.flatMap((l, i) => (holes[i] ? [shape(l, true)] : [])),
      ],
      true,
    )
    masks.push(area)
    view.addChild(
      masked(mapFill(map, id ? env.tex(id) : undefined, id ? undefined : "#7d6b55"), area.sprite()),
    )
    const part = id ? materialBorderPart(id) : undefined
    const border = id && part ? env.tex(id, { part }) : undefined
    if (!border) continue
    const smooth = mine[mine.length - 1].params.smooth === true
    const width = border.height / TEXTURE_PX_PER_TILE
    for (const loop of loops) {
      const line = smooth ? chaikinLoop(loop) : loop
      const tris = wallTriangles(line, true, width, { bevel: false, normalizeUv: false })
      view.addChild(lineMesh(tris, width * (border.width / border.height), border, 0))
    }
  }
  return composite(view, masks)
}

type CompositeBuilder = (
  entities: MapEntity[],
  map: MapBox,
  renderer: Renderer,
  env: RenderEnv,
) => Composite

/** Painted tools and how they composite. Their entities never get per-entity renderers. */
export const PAINTED_COMPOSITES: Record<string, CompositeBuilder> = {
  cave: caveComposite,
  water: waterComposite,
  terrainBrush: terrainComposite,
  material: materialComposite,
}

/** Layer the composite of a painted tool draws at (z-order bucket). */
export function paintedLayer(toolId: string, entities: readonly MapEntity[]): number {
  if (toolId === "terrainBrush") return -500
  if (toolId === "cave") return -300
  if (toolId === "water") return 0
  return entities[entities.length - 1]?.layer ?? -400
}

/**
 * A painted tool's composites on a level: one per tool, except materials —
 * one per layer, as Dungeondraft keeps a material layer per layer value.
 */
export function paintedGroups(
  toolId: string,
  entities: readonly MapEntity[],
): { key: string; entities: MapEntity[] }[] {
  if (toolId !== "material")
    return entities.length ? [{ key: toolId, entities: [...entities] }] : []
  const byLayer = new Map<number, MapEntity[]>()
  for (const e of entities) {
    const list = byLayer.get(e.layer)
    if (list) list.push(e)
    else byLayer.set(e.layer, [e])
  }
  return [...byLayer].map(([layer, list]) => ({ key: `${toolId}@${layer}`, entities: list }))
}
