import {
  BlurFilter,
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
import { type BrushStroke, type MapEntity } from "../model/types"
import { TEXTURE_PX_PER_TILE } from "./assets"
import { type RenderEnv, selectionAsset } from "./entities"
import { softBrushTexture } from "./generated"
import { LayerMaskFilter } from "./layerFilter"
import { type TerrainData } from "../model/terrain"
import { liveTerrain, weightsOf } from "../terrainLive"
import { packWeights } from "./splat"
import { TerrainFilter } from "./terrainFilter"

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
  ) {
    this.res = maskResolution(map)
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

/** Hard-edged stroke shape (round caps/joins) in content space. */
function strokeShape(stroke: BrushStroke, extraRadius = 0, color = 0xffffff): Graphics {
  const g = new Graphics()
  const r = Math.max(0.01, stroke.radius + extraRadius)
  const [first] = stroke.points
  if (!first) return g
  if (stroke.points.length === 1) {
    g.circle(-first.x, first.y, r).fill({ color })
  } else {
    g.poly(
      stroke.points.flatMap((p) => [-p.x, p.y]),
      false,
    ).stroke({
      width: r * 2,
      color,
      cap: "round",
      join: "round",
    })
  }
  if (stroke.erase) g.blendMode = "erase"
  return g
}

/** Soft-edged stamps along a stroke (terrain/material blending). */
function softStroke(stroke: BrushStroke, alpha: number): Container {
  const c = new Container()
  const tex = softBrushTexture()
  const spacing = Math.max(0.05, stroke.radius * 0.3)
  const stamp = (x: number, y: number) => {
    const s = new Sprite(tex)
    s.anchor.set(0.5)
    s.position.set(-x, y)
    s.width = s.height = stroke.radius * 2
    s.alpha = alpha
    c.addChild(s)
  }
  const pts = stroke.points
  if (pts.length === 1) stamp(pts[0].x, pts[0].y)
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.ceil(len / spacing))
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
    }
  }
  if (pts.length > 1) stamp(pts[pts.length - 1].x, pts[pts.length - 1].y)
  if (stroke.erase) c.blendMode = "erase"
  return c
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

/**
 * Every painted shape of the entities, in order: brush strokes plus closed
 * polygons (Water's rectangle/ellipse/polygon bodies; `params.erase` ones —
 * Alt-drawn — cut instead). `grow` widens each shape (negative shrinks),
 * with erasing strokes growing the opposite way so a grown area stays
 * consistent; erasing polygons keep their size.
 */
function shapesOf(entities: readonly MapEntity[], grow = 0): Graphics[] {
  const out: Graphics[] = []
  for (const e of entities) {
    for (const s of e.strokes ?? []) out.push(strokeShape(s, s.erase ? -grow : grow))
    if (e.closed && e.points && e.points.length > 2) {
      const flat = e.points.flatMap((p) => [-p.x, p.y])
      const body = new Graphics().poly(flat, true).fill({ color: 0xffffff })
      if (e.params.erase === true) {
        body.blendMode = "erase"
        out.push(body)
        continue
      }
      if (grow > 0) body.stroke({ width: grow * 2, color: 0xffffff, join: "round" })
      out.push(body)
      if (grow < 0) {
        // Shrinking a polygon = erasing a band along its edge.
        const band = new Graphics()
          .poly(flat, true)
          .stroke({ width: -grow * 2, color: 0xffffff, join: "round" })
        band.blendMode = "erase"
        out.push(band)
      }
    }
  }
  return out
}
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback)
const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback)

/** Cave wall thickness in tiles (the rim drawn around dug floor). */
const CAVE_WALL = 0.3

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
  const ground = str(last.params.groundColor, "#6b3834")
  const wallColor = str(last.params.wallColor, "#6b3834")
  const floor = new MapMask(renderer, map)
  floor.draw(shapesOf(entities), true)
  // The rim is the dug area grown by the wall thickness (blasts shrink it).
  const rim = new MapMask(renderer, map)
  rim.draw(shapesOf(entities, CAVE_WALL), true)

  const view = new Container()
  view.addChild(
    masked(
      textureOrColor(map, env.tex(id, { part: "wall", color: wallColor }), wallColor),
      rim.sprite(),
    ),
  )
  view.addChild(masked(textureOrColor(map, env.tex(id, { color: ground }), ground), floor.sprite()))
  return composite(view, [floor, rim])
}

function waterComposite(entities: MapEntity[], map: MapBox, renderer: Renderer): Composite {
  const last = entities[entities.length - 1]
  const deep = str(last.params.deepColor, "#3aa19a")
  const shallow = str(last.params.shallowColor, "#8bceb0")
  const blend = num(last.params.blendDistance, 1.5)
  const masks: MapMask[] = []
  const view = new Container()

  if (last.params.disableBorder !== true) {
    const border = new MapMask(renderer, map)
    border.draw(shapesOf(entities, 0.06), true)
    masks.push(border)
    view.addChild(masked(mapFill(map, undefined, "#24343a"), border.sprite()))
  }

  const area = new MapMask(renderer, map)
  area.draw(shapesOf(entities), true)
  // Deep water: the area shrunk by the blend distance, then blurred so it
  // fades into the shallow edge.
  const core = new MapMask(renderer, map)
  const shrunk = new Container()
  shrunk.addChild(...shapesOf(entities, -blend * 0.3))
  shrunk.filters = [new BlurFilter({ strength: blend * core.res * 0.2 })]
  core.draw([shrunk], true)
  masks.push(area, core)

  view.addChild(masked(mapFill(map, undefined, shallow), area.sprite()))
  view.addChild(masked(mapFill(map, undefined, deep), core.sprite()))
  view.alpha = 0.92
  return composite(view, masks)
}

/**
 * Terrain: one splat per level (slot weights, 4 texels per tile — see
 * model/terrain.ts), blended in one pass by Dungeondraft's formula
 * (terrainFilter.ts). The weights are packed three slots per RGB texture,
 * filtered bilinearly like Dungeondraft's splat; while a stroke is being
 * painted they're re-packed from the live buffer on every tick (refresh).
 */
function terrainComposite(
  entities: MapEntity[],
  map: MapBox,
  _renderer: Renderer,
  env: RenderEnv,
): Composite {
  const view = new Container()
  const entity = [...entities].reverse().find((e) => e.params.terrain)
  if (!entity) return { view, dispose: () => view.destroy() }
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
  const pack = () => {
    packWeights(
      liveTerrain(entity.id) ?? weightsOf(data),
      sources.map((src) => src.resource as Uint8Array),
    )
    for (const src of sources) src.update()
  }
  pack()
  const [w0, w1, w2] = sources.map((source) => new Texture({ source }))
  const weights: [Texture, Texture, Texture] = [w0, w1, w2]
  const area = new Sprite(Texture.WHITE)
  area.position.set(-map.width, 0)
  area.width = map.width
  area.height = map.height
  const filter = new TerrainFilter(area, {
    textures: data.slots.map((id) => (id ? env.tex(id) : undefined)),
    weights,
    smooth: env.terrainSmooth,
    map,
  })
  area.filters = [filter]
  view.addChild(area)
  return {
    view,
    dispose: () => {
      view.destroy({ children: true })
      filter.destroy()
      for (const t of weights) t.destroy(true)
    },
    refresh: pack,
  }
}

/** Material brush: one soft mask per painted material texture. */
function materialComposite(
  entities: MapEntity[],
  map: MapBox,
  renderer: Renderer,
  env: RenderEnv,
): Composite {
  const masks = new Map<string, MapMask>()
  for (const e of entities) {
    const { id } = selectionAsset(e.params.material)
    const key = id ?? ""
    for (const stroke of e.strokes ?? []) {
      if (!masks.has(key)) masks.set(key, new MapMask(renderer, map))
      masks.get(key)?.draw([softStroke(stroke, 1)], false)
    }
  }
  const view = new Container()
  for (const [id, m] of masks) {
    view.addChild(
      masked(mapFill(map, id ? env.tex(id) : undefined, id ? undefined : "#7d6b55"), m.sprite()),
    )
  }
  return composite(view, masks.values())
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
