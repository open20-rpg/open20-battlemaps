import {
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Point,
  BitmapText,
  Sprite,
  type Texture,
} from "pixi.js"
import { hexToPixiColor } from "../../../lib/colors"
import { boundsOf, sub, wallRuns, type WallOpening } from "../model/geometry"
import {
  pathTriangles,
  pathWidths,
  smoothPath,
  wallTriangles,
  type LineTriangle,
} from "./lineGeometry"
import { type MapEntity, type Vec2 } from "../model/types"
import { type TextureRequest, TEXTURE_PX_PER_TILE } from "./assets"
import { lightFalloffTexture } from "./generated"
import { quickboxRoof, roofFaceShade, roofGeometry, slopeUv, type RoofType } from "./roofGeometry"
import { wearOverlay, wornMesh } from "./buildingWear"
import { blockingSegments, lightPolygon, type Segment } from "../model/lightBlock"
import { type FontChoice } from "../../fonts/catalog"
import {
  borderOf,
  FONT_PX_PER_TILE,
  layoutTextBox,
  measureText,
  textStyle,
} from "../../fonts/metrics"
import { sdfFont } from "./sdfFont"
import { tiledMesh } from "./tiling"

/**
 * Per-entity renderers, keyed by the tool that created the entity. They draw
 * into "content space": the world container mirrors map x (see viewport.ts),
 * so content containers flip it back (scale.x = -1) and renderers place
 * things at (-x, y). That keeps sprites and text readable instead of mirrored.
 */

export interface RenderEnv {
  /** Texture lookup that remembers misses, so the scene retries once loaded. */
  tex: (id: string | undefined, req?: TextureRequest) => Texture | undefined
  /**
   * Hand the scene a drop-shadow silhouette (black, opaque, in content space,
   * not offset). The scene draws every shadow in one layer and applies the
   * user's shadow style (offset, softness, opacity) and the view toggle there.
   */
  castShadow: (shadow: Container, kind: ShadowKind) => void
  /** Text tool's "Visible" toggle. */
  textVisible: boolean
  /** Lighting view toggle (light glows hide with it). */
  lighting: boolean
  /** Terrain Brush Smooth Blending, applied to every terrain stroke. */
  terrainSmooth: boolean
  /** Portals on the level (walls leave openings where they sit). */
  portals: readonly MapEntity[]
  /** What stops light on the level (lights with Shadow on are cut by it). */
  lightBlockers: readonly MapEntity[]
  /** Asset size in tiles (remembers misses like `tex`). */
  size: (id: string | undefined) => { w: number; h: number } | undefined
  /**
   * Whether an asset is recolored by its red regions (Colorable objects,
   * "custom_color" tilesets) rather than tinted by its color.
   */
  colorable: (id: string | undefined) => boolean
  /** Cave tool's "Show blast opened area": draw the blasted area (editor only). */
  showCaveBlast: boolean
  /** An image bundled with the app (by URL), once loaded (remembers misses like `tex`). */
  image: (url: string) => Texture | undefined
  /**
   * Whether `font` can be drawn now (else labels use the fallback); one still
   * loading from the cache is remembered like a texture miss.
   */
  font: (font: FontChoice) => boolean
  /** The map's building wear texture (buildingWear.ts): none, or once loaded (remembers misses like `tex`). */
  buildingWear: () => Texture | undefined
}

/** What casts a shadow (each kind can be turned off in the shadow settings). */
export const SHADOW_KINDS = ["objects", "walls", "portals", "paths", "patterns", "roofs"] as const
export type ShadowKind = (typeof SHADOW_KINDS)[number]

/** Whether an entity casts its shadow (on unless its Shadow switch is off). */
const castsShadow = (e: MapEntity) => e.params.shadow !== false

/** A black silhouette of a polygon (content space), for shadows. */
function polygonSilhouette(points: Vec2[]): Graphics {
  return new Graphics()
    .poly(
      points.flatMap((p) => [-p.x, p.y]),
      true,
    )
    .fill({ color: 0x000000 })
}

export type EntityRenderer = (entity: MapEntity, env: RenderEnv) => Container

/** Map point to content space. */
export const toContent = (p: Vec2): Point => new Point(-p.x, p.y)

const rad = (deg: number) => (deg * Math.PI) / 180
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback)
const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback)

/** First asset id of an `{ assets, color }` selection param. */
export function selectionAsset(value: unknown): { id?: string; color?: string } {
  const sel = value as { assets?: string[]; color?: string } | undefined
  return { id: sel?.assets?.[0], color: sel?.color }
}

/** Grey box shown while an object's texture is loading (or its pack is missing). */
function placeholder(w = 1, h = 1): Graphics {
  return new Graphics()
    .rect(-w / 2, -h / 2, w, h)
    .fill({ color: 0x9aa0a6, alpha: 0.35 })
    .stroke({ width: 0.03, color: 0x9aa0a6, alpha: 0.8 })
}

/** A centered sprite (objects, scatter, portals) with optional drop shadow. */
function spriteEntity(
  entity: MapEntity,
  env: RenderEnv,
  assetId: string | undefined,
  color?: string,
  shadowKind: ShadowKind = "objects",
): Container {
  const root = new Container()
  const p = toContent(entity.position)
  root.position.copyFrom(p)
  root.rotation = rad(entity.rotation)
  const scale = (entity.scale ?? 1) / TEXTURE_PX_PER_TILE
  // Flips are in the sprite's own frame (applied before its rotation).
  const sx = scale * (entity.flipX ? -1 : 1)
  const sy = scale * (entity.flipY ? -1 : 1)
  const texture = env.tex(assetId, { color })
  if (!texture) {
    root.addChild(placeholder())
    return root
  }
  if (castsShadow(entity)) {
    const shadow = new Sprite(texture)
    shadow.anchor.set(0.5)
    shadow.scale.set(sx, sy)
    shadow.tint = 0x000000
    shadow.position.copyFrom(p)
    shadow.rotation = root.rotation
    env.castShadow(shadow, shadowKind)
  }
  const sprite = new Sprite(texture)
  sprite.anchor.set(0.5)
  sprite.scale.set(sx, sy)
  root.addChild(sprite)
  return root
}

const objectRenderer: EntityRenderer = (e, env) =>
  spriteEntity(e, env, str(e.params.asset, ""), str(e.params.color, ""))

const portalRenderer: EntityRenderer = (e, env) =>
  spriteEntity(e, env, str(e.params.asset, ""), undefined, "portals")

/**
 * Draw line triangles (walls, paths: see lineGeometry.ts). Textured lines
 * repeat the texture along their length at its own aspect ratio: one
 * repeat every `repeat` tiles (the texture's width at the line's scale), so
 * it's never stretched lengthwise; untextured ones fill with `color`.
 * Triangles are grouped by opacity (path fades), one mesh per group.
 */
export function lineMesh(
  tris: readonly LineTriangle[],
  repeat: number,
  texture: Texture | undefined,
  color: number,
  /** Tint over the texture/color (e.g. black for a shadow). */
  tint?: number,
  /** Building wear multiplied over the texture, in world coordinates (walls only). */
  wear?: Texture,
): Container {
  const root = new Container()
  const groups = new Map<number, LineTriangle[]>()
  for (const t of tris) {
    const key = Math.round(t.alpha * 32) / 32
    if (key <= 0) continue
    const group = groups.get(key)
    if (group) group.push(t)
    else groups.set(key, [t])
  }
  if (texture) texture.source.style.addressMode = "repeat"
  for (const [alpha, group] of groups) {
    if (!texture) {
      const g = new Graphics()
      for (const t of group) g.poly([-t.a.x, t.a.y, -t.b.x, t.b.y, -t.c.x, t.c.y], true)
      g.fill({ color: tint ?? color, alpha })
      root.addChild(g)
      continue
    }
    const positions = new Float32Array(group.length * 6)
    const uvs = new Float32Array(group.length * 6)
    let k = 0
    for (const t of group) {
      // Whole repeats off each triangle's u (the texture repeats, so it
      // looks the same): u keeps growing along a long wall, and large
      // texture coordinates lose precision in the GPU (stretched texels).
      const shift = Math.floor(Math.min(t.a.u, t.b.u, t.c.u) / repeat)
      for (const v of [t.a, t.b, t.c]) {
        positions[k] = -v.x
        positions[k + 1] = v.y
        uvs[k] = v.u / repeat - shift
        uvs[k + 1] = v.v
        k += 2
      }
    }
    const geometry = new MeshGeometry({
      positions,
      uvs,
      indices: Uint32Array.from({ length: group.length * 3 }, (_, i) => i),
    })
    const mesh = wear ? wornMesh(geometry, texture, wear) : new Mesh({ geometry, texture })
    mesh.alpha = alpha
    if (tint !== undefined) mesh.tint = tint
    root.addChild(mesh)
  }
  return root
}

/** Repeat length (tiles) of a line texture drawn `width` tiles wide. */
const repeatOf = (texture: Texture | undefined, width: number) =>
  texture ? width * (texture.width / texture.height) : 1

/** Default wall thickness in tiles when no wall texture is set. */
export const WALL_WIDTH = 0.25

/** The openings the level's portals cut into walls. */
function portalOpenings(env: RenderEnv): WallOpening[] {
  return env.portals.map((p) => {
    const asset = typeof p.params.asset === "string" ? p.params.asset : undefined
    const w = (env.size(asset)?.w ?? 1) * (p.scale ?? 1)
    return { center: p.position, width: w }
  })
}

/**
 * A wall end's cap: its `<name>_end` texture centered on `at`, as wide as
 * the wall, turned along the wall's direction `dir` there (map space) and,
 * at the wall's start, mirrored. Built as a
 * quad (u 0…1 across the texture) so the wall wear covers it too.
 */
function capTriangles(
  texture: Texture,
  at: Vec2,
  dir: Vec2,
  width: number,
  start: boolean,
): LineTriangle[] {
  const l = Math.hypot(dir.x, dir.y) || 1
  const d = { x: dir.x / l, y: dir.y / l }
  const n = { x: -d.y, y: d.x }
  const w = width * (texture.width / texture.height)
  const s = start ? -1 : 1
  const v = (u: number, vv: number) => ({
    x: at.x + d.x * (u - 0.5) * w * s + n.x * (0.5 - vv) * width,
    y: at.y + d.y * (u - 0.5) * w * s + n.y * (0.5 - vv) * width,
    u,
    v: vv,
  })
  return [
    { a: v(0, 0), b: v(0, 1), c: v(1, 0), alpha: 1 },
    { a: v(0, 1), b: v(1, 1), c: v(1, 0), alpha: 1 },
  ]
}

/**
 * Walls: each continuous run (split where
 * portals open the wall) is one line as wide as the texture is tall, its
 * corners beveled (Bevel Corners, the default) or mitered, the texture
 * wrapping around them (see lineGeometry.ts). Open ends get the pack's
 * `<name>_end` cap texture when it has one. The map's building wear
 * (buildingWear.ts) is multiplied over walls and caps. The drop shadow is the same
 * geometry tinted black, so it follows the wall's real shape.
 */
const wallRenderer: EntityRenderer = (e, env) => {
  // Walls (and their ends) are multiplied by the wall's color.
  const { id, color } = selectionAsset(e.params.wall)
  const texture = env.tex(id)
  const cap = env.tex(id, { suffix: "_end" })
  const tint = color && texture ? hexToPixiColor(color).color : undefined
  const width = texture ? texture.height / TEXTURE_PX_PER_TILE : WALL_WIDTH
  const runs = wallRuns(e.points ?? [], !!e.closed, portalOpenings(env))
  const opts = { bevel: e.params.bevelCorners !== false, normalizeUv: true }
  const meshes = runs.map((run) => wallTriangles(run.points, run.closed, width, opts))
  const repeat = repeatOf(texture, width)

  const caps = cap
    ? runs.flatMap((run) => {
        const pts = run.points
        const n = pts.length
        if (run.closed || n < 2) return []
        return [
          ...capTriangles(cap, pts[0], sub(pts[1], pts[0]), width, true),
          ...capTriangles(cap, pts[n - 1], sub(pts[n - 1], pts[n - 2]), width, false),
        ]
      })
    : []

  const draw = (tint?: number, wear?: Texture): Container => {
    const layer = new Container()
    for (const tris of meshes) layer.addChild(lineMesh(tris, repeat, texture, 0x3b3631, tint, wear))
    if (cap && caps.length) layer.addChild(lineMesh(caps, 1, cap, 0x3b3631, tint, wear))
    return layer
  }

  const root = new Container()
  if (castsShadow(e)) env.castShadow(draw(0x000000), "walls")
  root.addChild(draw(tint, env.buildingWear()))
  return root
}

/**
 * Paths: as wide as the texture is tall times
 * Width, the edit points smoothed (Chaikin,
 * Smoothness), a 5-vertex section per point (lineGeometry.ts), the texture
 * repeated at the path's base width. Growth/shrink ease the width from 0
 * over a third of the points; fades ramp the opacity over the first/last
 * 10% of the length. Loops are opened at their closing midpoint.
 */
const pathRenderer: EntityRenderer = (e, env) => {
  const texture = env.tex(str(e.params.asset, ""))
  // Width is a multiplier of the texture's height (the Width param).
  const width = num(e.params.width, 1) * (texture ? texture.height / TEXTURE_PX_PER_TILE : 1)
  const pts = smoothPath(e.points ?? [], num(e.params.smoothness, 0), !!e.closed)
  const tIn = e.params.transitionIn
  const tOut = e.params.transitionOut
  const widths = pathWidths(pts.length, width, tIn === "growth", tOut === "growth")
  const tris = pathTriangles(pts, widths, tIn === "fade", tOut === "fade")
  const repeat = repeatOf(texture, width)
  if (castsShadow(e)) env.castShadow(lineMesh(tris, repeat, texture, 0, 0x000000), "paths")
  return lineMesh(tris, repeat, texture, 0x7a6a52)
}

/** Floor tiles take the building wear at half scale, as tilesets do. */
const FLOOR_WEAR_STRETCH = 2

/**
 * A polygon filled with a tiling texture (floors, patterns), at its own
 * size (one texture pixel per 1/256 tile, never stretched). The texture is
 * laid from the entity's `position` turned by `rotation` (degrees, clockwise
 * on screen), so it moves and turns with the shape: moving or rotating it
 * (transformEntity) carries both along, while reshaping it leaves the
 * texture in place. New shapes start at the map's origin, so adjacent
 * fills line up on the grid.
 */
function tiledPolygon(
  points: Vec2[],
  texture: Texture | undefined,
  tint: string | undefined,
  frame: { origin: Vec2; rotation: number },
  fallbackColor: number,
  /** Building wear multiplied over the fill (floors). */
  wear?: Texture,
): Container {
  const root = new Container()
  if (points.length < 3) return root
  const flat = points.flatMap((p) => [-p.x, p.y])
  if (!texture) {
    root.addChild(new Graphics().poly(flat, true).fill({ color: fallbackColor }))
    return root
  }
  const b = boundsOf(points)
  // Content-space bounds (x is flipped), padded so the edges are covered.
  const x0 = Math.floor(-(b.x + b.w)) - 1
  const y0 = Math.floor(b.y) - 1
  const w = Math.ceil(b.w) + 2
  const h = Math.ceil(b.h) + 2
  // A mesh with our own uvs, not a TilingSprite: its texture can only turn
  // and move (never scale with the fill's size), and its uvs stay small.
  texture.source.style.addressMode = "repeat"
  const fill = new Mesh({
    geometry: new MeshGeometry(
      tiledMesh(
        { x: x0, y: y0, w, h },
        toContent(frame.origin),
        rad(frame.rotation),
        texture.width / TEXTURE_PX_PER_TILE,
        texture.height / TEXTURE_PX_PER_TILE,
      ),
    ),
    texture,
  })
  if (tint) fill.tint = hexToPixiColor(tint).color
  const mask = new Graphics().poly(flat, true).fill({ color: 0xffffff })
  const body = new Container()
  body.addChild(fill)
  if (wear) body.addChild(wearOverlay(wear, x0, y0, w, h, FLOOR_WEAR_STRETCH))
  root.addChild(body, mask)
  body.mask = mask
  return root
}

/**
 * Floors, as tilesets: a "normal" one is multiplied by the
 * floor's color, a "custom_color" one has its red regions take it.
 */
const floorRenderer: EntityRenderer = (e, env) => {
  const { id, color } = selectionAsset(e.params.floor)
  const red = env.colorable(id)
  return tiledPolygon(
    e.points ?? [],
    env.tex(id, red ? { color, recolorMode: "tileset" } : undefined),
    red ? undefined : color,
    { origin: e.position, rotation: e.rotation },
    0x8a7a62,
    env.buildingWear(),
  )
}

const patternRenderer: EntityRenderer = (e, env) => {
  if (castsShadow(e) && (e.points?.length ?? 0) > 2) {
    env.castShadow(polygonSilhouette(e.points ?? []), "patterns")
  }
  // Colorable patterns' red regions take the color; others are multiplied by it.
  const { id } = selectionAsset(e.params.pattern)
  const color = str(e.params.customColor, "#ffffff")
  const red = env.colorable(id)
  const root = tiledPolygon(
    e.points ?? [],
    env.tex(id, red ? { color, recolorMode: "tileset" } : undefined),
    red ? undefined : color,
    // The Rotation param turns the texture on top of the shape's own turn.
    { origin: e.position, rotation: e.rotation + num(e.params.rotation, 0) },
    hexToPixiColor(color).color,
  )
  if (e.params.outline === true && e.points && e.points.length > 2) {
    root.addChild(
      new Graphics()
        .poly(
          e.points.flatMap((p) => [-p.x, p.y]),
          true,
        )
        .stroke({ width: 0.06, color: 0x1e1e1e, join: "round" }),
    )
  }
  return root
}

/** Brightness multiplier of a roof face whose downhill normal points at `normalDeg`. */
export function roofShade(normalDeg: number, sunDeg: number, contrast: number): number {
  // 1 when the face looks straight at the sun, 1 - contrast when it faces away.
  const facing = (Math.cos(rad(normalDeg - sunDeg)) + 1) / 2
  return 1 - contrast * (1 - facing)
}

/** Multiply each RGB channel of a 24-bit color by `k` (0..1). */
export function shadeColor(color: number, k: number): number {
  const r = Math.round(((color >> 16) & 0xff) * k)
  const g = Math.round(((color >> 8) & 0xff) * k)
  const b = Math.round((color & 0xff) * k)
  return (r << 16) | (g << 8) | b
}

/** A roof's ridge and width: as drawn, or (older polygon roofs) from its box. */
function roofShape(e: MapEntity): { ridge: Vec2[]; width: number } {
  const pts = e.points ?? []
  if (e.closed && pts.length > 2) {
    const b = boundsOf(pts)
    return quickboxRoof({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h })
  }
  return { ridge: pts, width: num(e.params.width, 3) }
}

/** A textured polygon (a roof face), its uv per vertex given in texture units. */
function facePolygon(
  points: readonly Vec2[],
  uv: (v: Vec2) => Vec2,
  texture: Texture,
  tint: number,
): Mesh {
  const positions = new Float32Array(points.flatMap((p) => [-p.x, p.y]))
  const uvs = new Float32Array(
    points.flatMap((p) => {
      const t = uv(p)
      return [t.x, t.y]
    }),
  )
  // A fan from the first vertex (faces are convex quads and triangles).
  const indices: number[] = []
  for (let k = 1; k + 1 < points.length; k++) indices.push(0, k, k + 1)
  const mesh = new Mesh({
    geometry: new MeshGeometry({ positions, uvs, indices: new Uint32Array(indices) }),
    texture,
  })
  mesh.tint = tint
  return mesh
}

/** A gray level (0–1) as a tint. */
const grayTint = (v: number) => {
  const c = Math.round(Math.min(1, Math.max(0, v)) * 255)
  return (c << 16) | (c << 8) | c
}

/**
 * Roofs (roofGeometry.ts): the slopes
 * tiled with the style's texture, turned so its rows run along the ridge,
 * each shaded by the sun; then the ridge, the eave edge (always in the
 * contrast's shadow) and the hip lines, each a line as wide as its texture
 * (the style's `ridge`, `edge` and `hip` files next to `tiles`).
 */
const roofRenderer: EntityRenderer = (e, env) => {
  const root = new Container()
  const { ridge, width } = roofShape(e)
  const type = str(e.params.type, "gable") as RoofType
  const g = roofGeometry(ridge, width, type)
  if (!g) return root
  if (castsShadow(e)) env.castShadow(polygonSilhouette(g.edge), "roofs")
  const { id } = selectionAsset(e.params.style)
  const tiles = env.tex(id)
  const shade = e.params.shade !== false
  const sun = num(e.params.sunDirection, 45)
  const contrast = num(e.params.shadeContrast, 0.3)
  const faceTint = (n: Vec2) => grayTint(shade ? roofFaceShade(n, sun, contrast) : 1)

  for (const face of [...g.slopes, ...g.tips]) {
    if (tiles) {
      tiles.source.style.addressMode = "repeat"
      const uv = (v: Vec2) =>
        slopeUv(v, face.normal, TEXTURE_PX_PER_TILE, tiles.width, tiles.height)
      root.addChild(facePolygon(face.points, uv, tiles, faceTint(face.normal)))
    } else {
      const tint = shadeColor(0x7b4a36, shade ? roofFaceShade(face.normal, sun, contrast) : 1)
      root.addChild(
        new Graphics()
          .poly(
            face.points.flatMap((p) => [-p.x, p.y]),
            true,
          )
          .fill({ color: tint }),
      )
    }
  }
  /** One of the roof's lines, as wide as its texture is tall. */
  const line = (pts: Vec2[], closed: boolean, part: string, bevel: boolean, tint?: number) => {
    const tex = env.tex(id, { part })
    if (!tex || pts.length < 2) return
    const w = tex.height / TEXTURE_PX_PER_TILE
    const tris = wallTriangles(pts, closed, w, { bevel, normalizeUv: false })
    root.addChild(lineMesh(tris, repeatOf(tex, w), tex, 0x2a1a12, tint))
  }
  line(g.ridge, false, "ridge", true)
  line(g.edge, g.edgeClosed, "edge", false, grayTint(1 - contrast))
  for (const hip of g.hips) line(hip, false, "hip", true)
  return root
}

/**
 * A text label: one line in a distance-field
 * bitmap font (sdfFont.ts) inside its optional box, laid out in font px from
 * the top-left corner (fonts/metrics) and scaled to tiles (64 font px per
 * tile). Moving it only moves this container (see the scene).
 */
const textRenderer: EntityRenderer = (e, env) => {
  const root = new Container()
  root.visible = env.textVisible
  root.position.copyFrom(toContent(e.position))
  root.scale.set(1 / FONT_PX_PER_TILE)
  const text = (e.text ?? "").replace(/\s*\n\s*/g, " ")
  const style = textStyle(e.params)
  const ready = env.font(style.font)
  const box = layoutTextBox(measureText(style.font, style.size, text), borderOf(style))
  if (style.box !== "none") {
    const bw = style.borderWidth
    const r = style.box === "pill" ? Math.min(box.w, box.h) / 2 : 0
    const bg = hexToPixiColor(style.background)
    const border = hexToPixiColor(style.borderColor)
    const g = new Graphics()
    if (bw > 0) {
      g.roundRect(0, 0, box.w, box.h, r).fill({ color: border.color, alpha: border.alpha })
      g.roundRect(bw, bw, box.w - 2 * bw, box.h - 2 * bw, Math.max(0, r - bw)).cut()
    }
    g.roundRect(bw, bw, box.w - 2 * bw, box.h - 2 * bw, Math.max(0, r - bw)).fill({
      color: bg.color,
      alpha: bg.alpha,
    })
    root.addChild(g)
  }
  if (text) {
    const color = hexToPixiColor(style.color)
    const label = new BitmapText({
      text,
      style: { fontFamily: sdfFont(style.font, ready, text), fontSize: style.size, fill: 0xffffff },
    })
    label.tint = color.color
    label.alpha = color.alpha
    // The atlas's line top: the baseline lands `ascent` below it.
    label.position.set(box.textX, borderOf(style))
    root.addChild(label)
  }
  return root
}

/** Renderers by tool id. Painted tools (cave, water, terrain, material) and lights are composited separately. */
/**
 * A light's glow: its falloff texture (the Style, or a soft default) tinted
 * with its color and added on top of the map. Godot lights multiply the base
 * by (ambient + lights), which can exceed 1 and so brightens a fully lit map;
 * the lighting composite (lighting.ts) is clamped at 1, so this glow stands in
 * for that overbright part. The scene fades it with the ambient brightness
 * ({@link glowStrength}): on a dark map the lights show through the light map
 * alone instead of a colored haze.
 */
/** The blocking segments of the level's blockers, kept while they're the same entities. */
let segmentsMemo: { blockers: readonly MapEntity[]; segments: Segment[] } | null = null
function blockersSegments(env: RenderEnv): Segment[] {
  const blockers = env.lightBlockers
  const memo = segmentsMemo
  if (
    memo &&
    memo.blockers.length === blockers.length &&
    memo.blockers.every((b, i) => b === blockers[i])
  )
    return memo.segments
  const segments = blockingSegments(blockers, (id) => env.size(id))
  segmentsMemo = { blockers, segments }
  return segments
}

/**
 * What a light reaches (content space), when it casts shadows: its
 * visibility polygon against the walls, closed doors and light-blocking
 * objects. Null when it doesn't (Shadow off) — it then lights everything in range.
 */
export function lightReach(e: MapEntity, env: RenderEnv): Graphics | null {
  if (e.params.shadow === false) return null
  const segments = blockersSegments(env)
  if (segments.length === 0) return null
  const poly = lightPolygon(e.id, e.position, num(e.params.range, 5), segments)
  return new Graphics().poly(poly.flatMap((p) => [-p.x, p.y])).fill({ color: 0xffffff })
}

const lightRenderer: EntityRenderer = (e, env) => {
  const root = new Container()
  root.visible = env.lighting
  const { id } = selectionAsset(e.params.style)
  const glow = new Sprite(env.tex(id) ?? lightFalloffTexture())
  glow.anchor.set(0.5)
  glow.position.copyFrom(toContent(e.position))
  glow.rotation = rad(e.rotation)
  const range = num(e.params.range, 5)
  glow.width = glow.height = range * 2
  glow.tint = hexToPixiColor(str(e.params.color, "#eccd8b")).color
  glow.alpha = Math.min(1, LIGHT_GLOW * num(e.params.intensity, 1))
  glow.blendMode = "add"
  root.addChild(glow)
  const reach = lightReach(e, env)
  if (reach) {
    root.addChild(reach)
    glow.mask = reach
  }
  return root
}

/** Glow strength at intensity 1 (keeps a white-ambient map from washing out). */
export const LIGHT_GLOW = 0.45

/**
 * How much of the light glow shows under an ambient color (0..1): full under
 * white, gone as the ambient darkens. Cubed luminance so a dim map (where the
 * light map already shows the lights) gets almost none.
 */
export function glowStrength(ambient: string): number {
  const c = hexToPixiColor(ambient).color
  const r = ((c >> 16) & 255) / 255
  const g = ((c >> 8) & 255) / 255
  const b = (c & 255) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum ** 3
}

export const ENTITY_RENDERERS: Record<string, EntityRenderer> = {
  light: lightRenderer,
  object: objectRenderer,
  scatter: objectRenderer,
  portal: portalRenderer,
  wall: wallRenderer,
  build: floorRenderer,
  path: pathRenderer,
  pattern: patternRenderer,
  roof: roofRenderer,
  text: textRenderer,
}
