import {
  BlurFilter,
  BufferImageSource,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  Texture,
  TilingSprite,
  type Filter,
  type Renderer,
} from "pixi.js"
import { hexToPixiColor } from "../../../lib/colors"
import { type BrushStroke, type MapEntity } from "../model/types"
import { TEXTURE_PX_PER_TILE } from "./assets"
import { type RenderEnv, selectionAsset } from "./entities"
import { softBrushTexture } from "./generated"
import { naturalEdgeFilter } from "./naturalEdge"
import { LayerMaskFilter } from "./layerFilter"
import { opaqueFilter } from "./opaque"
import { type SplatLayer } from "../format/dungeondraft"
import { SPLAT_UPSAMPLE, SplatStack, decodeBase64, sharpenWeights, upsampleWeights } from "./splat"

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
    stage.addChild(...children)
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
 * screen-clipped filter pass (see layerFilter.ts); `opaque` also drops the
 * fill's own alpha (terrain).
 */
function masked(fill: Container, mask: Sprite, opaque = false): Container {
  const c = new Container()
  // The mask sprite only needs its transform (the filter samples its texture).
  mask.renderable = false
  c.addChild(fill, mask)
  const filter = new LayerMaskFilter(mask, opaque)
  fill.filters = [filter]
  c.once("destroyed", () => filter.destroy())
  return c
}

/**
 * Every painted shape of the entities, in order: brush strokes plus closed
 * polygons (Water's rectangle/ellipse/polygon bodies). `grow` widens each
 * shape (negative shrinks), with erasing shapes growing the opposite way so
 * a grown area stays consistent.
 */
function shapesOf(entities: readonly MapEntity[], grow = 0): Graphics[] {
  const out: Graphics[] = []
  for (const e of entities) {
    for (const s of e.strokes ?? []) out.push(strokeShape(s, s.erase ? -grow : grow))
    if (e.closed && e.points && e.points.length > 2) {
      const flat = e.points.flatMap((p) => [-p.x, p.y])
      const body = new Graphics().poly(flat, true).fill({ color: 0xffffff })
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
/** The terrain's base texture over the whole map, opaque whatever its alpha (see opaque.ts). */
function terrainBase(map: MapBox, texture: Texture | undefined, color: string): Container {
  const fill = textureOrColor(map, texture, color)
  if (texture) fill.filters = [opaqueFilter()]
  return fill
}

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
 * An imported splat layer as a sprite over the map (content space). Splat
 * texel t's center sits at Dungeondraft world t × 64 px = t/4 cells, and
 * Dungeondraft x grows rightward like content space, so no flip is needed:
 * the layer just spans the map, offset by half a texel. Linear filtering
 * keeps the blend smooth between texels.
 */
function splatSprite(opacity: Uint8Array, splat: SplatLayer, scale: number, map: MapBox): Sprite {
  // Premultiplied white with the coverage as alpha.
  const rgba = new Uint8Array(opacity.length * 4)
  opacity.forEach((v, i) => rgba.fill(v, i * 4, i * 4 + 4))
  const source = new BufferImageSource({
    resource: rgba,
    width: splat.width * scale,
    height: splat.height * scale,
    scaleMode: "linear",
  })
  const sprite = new Sprite(new Texture({ source }))
  sprite.position.set(-map.width - 0.125, -0.125)
  sprite.width = splat.width / 4
  sprite.height = splat.height / 4
  return sprite
}

interface SplatOpacity {
  opacity: Uint8Array
  /** Opacity pixels per splat texel. */
  scale: number
}

/**
 * Each imported splat layer's opacity over the ones below. Layers after one
 * Fill (the imported base and its layers) blend together: their weights are
 * upsampled, sharpened as a set when Smooth Blending is off, then stacked.
 * Legacy saves carry precomputed opacities.
 */
function splatOpacities(entities: MapEntity[], smooth: boolean): Map<MapEntity, SplatOpacity> {
  const out = new Map<MapEntity, SplatOpacity>()
  let run: { e: MapEntity; splat: SplatLayer; weights: Float32Array }[] = []
  const flush = () => {
    if (run.length > 0 && !smooth) {
      const { splat } = run[0]
      const planes = run.map((r) => r.weights)
      sharpenWeights(planes, splat.width * SPLAT_UPSAMPLE, 4 * SPLAT_UPSAMPLE)
    }
    const stack = new SplatStack()
    for (const r of run) {
      const opacity = stack.push(r.weights)
      if (r.e.params.fill !== true) out.set(r.e, { opacity, scale: SPLAT_UPSAMPLE })
    }
    run = []
  }
  for (const e of entities) {
    if (e.params.fill === true) flush()
    const splat = e.params.splat as SplatLayer | undefined
    if (!splat) continue
    if (splat.weights) {
      const weights = upsampleWeights(
        decodeBase64(splat.weights),
        splat.width,
        splat.height,
        SPLAT_UPSAMPLE,
      )
      run.push({ e, splat, weights })
    } else if (splat.data) {
      out.set(e, { opacity: decodeBase64(splat.data), scale: 1 })
    }
  }
  flush()
  return out
}

/**
 * How much one Terrain Brush stroke covers, from its Intensity (0.2–8): low
 * intensities need several passes to fully replace the texture underneath,
 * the default (4) almost does it in one, high ones fully.
 */
export function terrainStrength(intensity: number): number {
  return Math.min(1, 1 - Math.exp(-Math.max(0, intensity) * 0.5))
}

/**
 * One stroke's coverage, rendered once into `scratch` (cleared) so the
 * stroke acts as a single layer: overlapping stamps within a stroke don't
 * stack, only separate strokes accumulate. Smooth Blending keeps the round
 * soft falloff; otherwise the falloff is broken up into natural edges.
 */
function strokeCoverage(stroke: BrushStroke, natural: Filter | null, scratch: MapMask): Sprite {
  const stamps = softStroke({ ...stroke, erase: false }, 1)
  if (natural) stamps.filters = [natural]
  scratch.draw([stamps], true)
  return scratch.sprite()
}

/**
 * Terrain splat: the base (slot 0 as painted, or the last Fill) covers the
 * map; every other texture is masked by its own coverage. Painting a texture
 * adds its stroke coverage (scaled by Intensity) to its mask and removes the
 * same coverage from every other mask, so the latest paint shows on top and
 * textures blend by coverage — no stacked semi-transparent layers.
 */
function terrainComposite(
  entities: MapEntity[],
  map: MapBox,
  renderer: Renderer,
  env: RenderEnv,
): Composite {
  const masks = new Map<string, MapMask>()
  const scratch = new MapMask(renderer, map)
  const natural = naturalEdgeFilter(scratch.res)
  let base: string | undefined
  // Smooth Blending is one switch for the whole terrain, as in Dungeondraft.
  const smooth = env.terrainSmooth
  const imported = splatOpacities(entities, smooth)
  for (const e of entities) {
    const texId = str(e.params.texture, "")
    if (!texId) continue
    // Until a Fill sets it, the base is slot 0 as it was when painting.
    if (!base && typeof e.params.base === "string") base = e.params.base
    const splat = e.params.splat as SplatLayer | undefined
    if (e.params.fill === true) {
      base = texId
      for (const m of masks.values()) m.draw([], true)
      continue
    }
    const opacity = imported.get(e)
    if (splat && opacity) {
      // An imported Dungeondraft splat layer: exact per-texel coverage
      // (already sharpened when Smooth Blending is off).
      if (!masks.has(texId)) masks.set(texId, new MapMask(renderer, map))
      const layer = splatSprite(opacity.opacity, splat, opacity.scale, map)
      const texture = layer.texture
      masks.get(texId)?.draw([layer], false)
      texture.destroy(true)
      continue
    }
    const strength = terrainStrength(num(e.params.intensity, 4))
    for (const stroke of e.strokes ?? []) {
      if (!masks.has(texId)) masks.set(texId, new MapMask(renderer, map))
      const paint = (target: MapMask, erase: boolean) => {
        const coverage = strokeCoverage(stroke, smooth ? null : natural, scratch)
        coverage.alpha = strength
        if (erase) coverage.blendMode = "erase"
        target.draw([coverage], false)
      }
      for (const [other, m] of masks) {
        // Right-drag erases the texture itself; painting erases the others.
        if (stroke.erase ? other === texId : other !== texId) paint(m, true)
      }
      if (!stroke.erase) paint(masks.get(texId) as MapMask, false)
    }
  }
  scratch.destroy()
  natural.destroy()
  const view = new Container()
  if (base) view.addChild(terrainBase(map, env.tex(base), "#6b7a4a"))
  for (const [texId, m] of masks) {
    view.addChild(masked(textureOrColor(map, env.tex(texId), "#9a8a6a"), m.sprite(), true))
  }
  return composite(view, masks.values())
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
