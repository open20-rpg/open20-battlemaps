import {
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Point,
  Sprite,
  Text,
  type Texture,
  TilingSprite,
} from "pixi.js"
import { hexToPixiColor } from "../../../lib/colors"
import { boundsOf, dist, stripOutline, sub, wallRuns, type WallOpening } from "../model/geometry"
import { type MapEntity, type Vec2 } from "../model/types"
import { type TextureRequest, TEXTURE_PX_PER_TILE } from "./assets"
import { lightFalloffTexture } from "./generated"

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
  castShadow: (shadow: Container) => void
  /** Text tool's "Visible" toggle. */
  textVisible: boolean
  /** Lighting view toggle (light glows hide with it). */
  lighting: boolean
  /** Portals on the level (walls leave openings where they sit). */
  portals: readonly MapEntity[]
  /** Asset size in tiles (remembers misses like `tex`). */
  size: (id: string | undefined) => { w: number; h: number } | undefined
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
): Container {
  const root = new Container()
  const p = toContent(entity.position)
  root.position.copyFrom(p)
  root.rotation = rad(entity.rotation)
  const scale = (entity.scale ?? 1) / TEXTURE_PX_PER_TILE
  const texture = env.tex(assetId, { color })
  if (!texture) {
    root.addChild(placeholder())
    return root
  }
  if (entity.params.shadow !== false) {
    const shadow = new Sprite(texture)
    shadow.anchor.set(0.5)
    shadow.scale.set(scale)
    shadow.tint = 0x000000
    shadow.position.copyFrom(p)
    shadow.rotation = root.rotation
    env.castShadow(shadow)
  }
  const sprite = new Sprite(texture)
  sprite.anchor.set(0.5)
  sprite.scale.set(scale)
  root.addChild(sprite)
  return root
}

const objectRenderer: EntityRenderer = (e, env) =>
  spriteEntity(e, env, str(e.params.asset, ""), str(e.params.color, ""))

// Portals sit in the wall opening; no drop shadow.
const portalRenderer: EntityRenderer = (e, env) =>
  spriteEntity({ ...e, params: { ...e.params, shadow: false } }, env, str(e.params.asset, ""))

/** Chaikin corner cutting; `iterations` 0 keeps the polyline as is. */
export function smoothPolyline(points: Vec2[], iterations: number): Vec2[] {
  let pts = points
  for (let k = 0; k < iterations && pts.length > 2; k++) {
    const next: Vec2[] = [pts[0]]
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    next.push(pts[pts.length - 1])
    pts = next
  }
  return pts
}

/**
 * A strip of `width` tiles along a polyline (walls, paths) with mitered
 * corners. Textured strips run the texture along the line, repeating it at
 * its own aspect ratio (one repeat = width × texture aspect), so it's never
 * stretched; untextured ones fill the outline with `color`.
 */
export function strip(
  points: Vec2[],
  closed: boolean,
  width: number,
  texture: Texture | undefined,
  color: number,
  /** Tint over the texture/color (e.g. black for a shadow). */
  tint?: number,
): Container {
  const root = new Container()
  if (points.length < 2) return root
  const outline = stripOutline(points, closed, width)
  // A closed strip repeats its first point at the end so the texture wraps.
  const centers = closed ? [...points, points[0]] : points
  const sides = closed ? [...outline, outline[0]] : outline
  if (!texture) {
    const ring = [...sides.map((s) => s.left), ...sides.map((s) => s.right).reverse()]
    root.addChild(
      new Graphics()
        .poly(
          ring.flatMap((p) => [-p.x, p.y]),
          true,
        )
        .fill({ color: tint ?? color }),
    )
    return root
  }
  texture.source.style.addressMode = "repeat"
  const repeat = width * (texture.width / texture.height)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  // One quad per segment (corner vertices shared in position, not in UV):
  // each vertex's u is its projection on that segment's direction, so the
  // texture runs straight along every segment and only the miter seam is
  // diagonal — a shared u at a mitered corner would skew the whole side.
  let along = 0
  for (let k = 0; k + 1 < centers.length; k++) {
    const c0 = centers[k]
    const c1 = centers[k + 1]
    const len = dist(c0, c1)
    if (len === 0) continue
    const d = { x: (c1.x - c0.x) / len, y: (c1.y - c0.y) / len }
    const u = (v: Vec2) => (along + (v.x - c0.x) * d.x + (v.y - c0.y) * d.y) / repeat
    const base = positions.length / 2
    for (const v of [sides[k].left, sides[k].right, sides[k + 1].left, sides[k + 1].right]) {
      positions.push(-v.x, v.y)
    }
    uvs.push(
      u(sides[k].left),
      0,
      u(sides[k].right),
      1,
      u(sides[k + 1].left),
      0,
      u(sides[k + 1].right),
      1,
    )
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
    along += len
  }
  const geometry = new MeshGeometry({
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  })
  const mesh = new Mesh({ geometry, texture })
  if (tint !== undefined) mesh.tint = tint
  root.addChild(mesh)
  return root
}

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

/** A wall's end-cap sprite at `at`, facing along `dir` (map space). */
function endCap(texture: Texture, at: Vec2, dir: Vec2, width: number, tint?: number): Sprite {
  const cap = new Sprite(texture)
  if (tint !== undefined) cap.tint = tint
  cap.anchor.set(0.5)
  cap.position.set(-at.x, at.y)
  // Content space mirrors x, so the direction's x flips too.
  cap.rotation = Math.atan2(dir.y, -dir.x)
  cap.scale.set(width / texture.height)
  return cap
}

/**
 * Walls: each continuous run (split only where portals open the wall) is one
 * mitered strip, so corners join cleanly. Open ends get the pack's
 * `<name>_end` cap texture when it has one. The drop shadow is the same
 * geometry tinted black, so it follows the wall's real shape.
 */
const wallRenderer: EntityRenderer = (e, env) => {
  const { id, color } = selectionAsset(e.params.wall)
  const texture = env.tex(id, { color })
  const cap = env.tex(id, { color, suffix: "_end" })
  const width = texture ? texture.height / TEXTURE_PX_PER_TILE : WALL_WIDTH
  const runs = wallRuns(e.points ?? [], !!e.closed, portalOpenings(env))

  const draw = (tint?: number): Container => {
    const layer = new Container()
    for (const run of runs) {
      layer.addChild(strip(run.points, run.closed, width, texture, 0x3b3631, tint))
      if (cap && !run.closed) {
        const pts = run.points
        const n = pts.length
        layer.addChild(endCap(cap, pts[0], sub(pts[0], pts[1]), width, tint))
        layer.addChild(endCap(cap, pts[n - 1], sub(pts[n - 1], pts[n - 2]), width, tint))
      }
    }
    return layer
  }

  const root = new Container()
  if (e.params.shadow !== false) env.castShadow(draw(0x000000))
  root.addChild(draw())
  return root
}

const pathRenderer: EntityRenderer = (e, env) => {
  const texture = env.tex(str(e.params.asset, ""))
  const smooth = Math.round(num(e.params.smoothness, 0) * 3)
  const pts = smoothPolyline(e.points ?? [], smooth)
  return strip(pts, false, num(e.params.width, 1), texture, 0x7a6a52)
}

/**
 * A polygon filled with a tiling texture (floors, patterns). The texture is
 * laid out on the map grid (not the shape) so adjacent fills line up.
 */
function tiledPolygon(
  points: Vec2[],
  texture: Texture | undefined,
  tint: string | undefined,
  rotation: number,
  fallbackColor: number,
): Container {
  const root = new Container()
  if (points.length < 3) return root
  const flat = points.flatMap((p) => [-p.x, p.y])
  if (!texture) {
    root.addChild(new Graphics().poly(flat, true).fill({ color: fallbackColor }))
    return root
  }
  const b = boundsOf(points)
  // Content-space bounds (x is flipped), padded to whole tiles to keep the
  // tiling anchored to the grid.
  const x0 = Math.floor(-(b.x + b.w)) - 1
  const y0 = Math.floor(b.y) - 1
  const w = Math.ceil(b.w) + 2
  const h = Math.ceil(b.h) + 2
  const fill = new TilingSprite({ texture, width: w, height: h })
  fill.position.set(x0, y0)
  fill.tileScale.set(1 / TEXTURE_PX_PER_TILE)
  fill.tilePosition.set(-x0 * TEXTURE_PX_PER_TILE, -y0 * TEXTURE_PX_PER_TILE)
  fill.tileRotation = rad(rotation)
  if (tint) fill.tint = hexToPixiColor(tint).color
  const mask = new Graphics().poly(flat, true).fill({ color: 0xffffff })
  root.addChild(fill, mask)
  fill.mask = mask
  return root
}

const floorRenderer: EntityRenderer = (e, env) => {
  const { id, color } = selectionAsset(e.params.floor)
  return tiledPolygon(e.points ?? [], env.tex(id, { color }), undefined, 0, 0x8a7a62)
}

const patternRenderer: EntityRenderer = (e, env) => {
  const { id } = selectionAsset(e.params.pattern)
  const color = str(e.params.customColor, "#ffffff")
  const root = tiledPolygon(
    e.points ?? [],
    env.tex(id, { color }),
    id ? undefined : color,
    num(e.params.rotation, 0),
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

const roofRenderer: EntityRenderer = (e, env) => {
  const root = new Container()
  const pts = e.points ?? []
  if (pts.length < 3) return root
  const b = boundsOf(pts)
  const type = str(e.params.type, "gable")
  const { id } = selectionAsset(e.params.style)
  const tiles = env.tex(id)
  const shade = e.params.shade !== false
  const sun = num(e.params.sunDirection, 45)
  const contrast = shade ? num(e.params.shadeContrast, 0.3) : 0

  // Faces in content space: [polygon, downhill normal (screen degrees)].
  const x0 = -(b.x + b.w)
  const x1 = -b.x
  const y0 = b.y
  const y1 = b.y + b.h
  const horizontal = b.w >= b.h
  const faces: [number[], number][] = []
  if (type === "hip") {
    const inset = Math.min(b.w, b.h) / 2
    if (horizontal) {
      const cy = (y0 + y1) / 2
      faces.push([[x0, y0, x1, y0, x1 - inset, cy, x0 + inset, cy], 270])
      faces.push([[x0, y1, x1, y1, x1 - inset, cy, x0 + inset, cy], 90])
      faces.push([[x0, y0, x0 + inset, cy, x0, y1], 180])
      faces.push([[x1, y0, x1 - inset, cy, x1, y1], 0])
    } else {
      const cx = (x0 + x1) / 2
      faces.push([[x0, y0, cx, y0 + inset, cx, y1 - inset, x0, y1], 180])
      faces.push([[x1, y0, cx, y0 + inset, cx, y1 - inset, x1, y1], 0])
      faces.push([[x0, y0, x1, y0, cx, y0 + inset], 270])
      faces.push([[x0, y1, x1, y1, cx, y1 - inset], 90])
    }
  } else if (horizontal) {
    const cy = (y0 + y1) / 2
    faces.push([[x0, y0, x1, y0, x1, cy, x0, cy], 270])
    faces.push([[x0, cy, x1, cy, x1, y1, x0, y1], 90])
  } else {
    const cx = (x0 + x1) / 2
    faces.push([[x0, y0, cx, y0, cx, y1, x0, y1], 180])
    faces.push([[cx, y0, x1, y0, x1, y1, cx, y1], 0])
  }
  // Dormers are short gables: same faces, drawn slightly smaller.
  const shrink = type === "dormer" ? 0.85 : 1
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  for (const [poly, normal] of faces) {
    const scaled = poly.map((v, i) =>
      i % 2 === 0 ? cx + (v - cx) * shrink : cy + (v - cy) * shrink,
    )
    const k = shade ? roofShade(normal, sun, contrast) : 1
    const tint = shadeColor(0xffffff, k)
    if (tiles) {
      tiles.source.style.addressMode = "repeat"
      const fill = new TilingSprite({ texture: tiles, width: b.w + 2, height: b.h + 2 })
      fill.position.set(x0 - 1, y0 - 1)
      fill.tileScale.set(1 / TEXTURE_PX_PER_TILE)
      // Tiles run downhill: rotate the pattern with the face normal.
      fill.tileRotation = rad(normal - 90)
      fill.tint = tint
      const mask = new Graphics().poly(scaled, true).fill({ color: 0xffffff })
      fill.mask = mask
      root.addChild(fill, mask)
    } else {
      root.addChild(new Graphics().poly(scaled, true).fill({ color: shadeColor(0x7b4a36, k) }))
    }
    root.addChild(
      new Graphics().poly(scaled, true).stroke({ width: 0.04, color: 0x2a1a12, alpha: 0.6 }),
    )
  }
  return root
}

/** Text resolution multiplier: rendered at 4x (or 2x without sharpening) then scaled down. */
const TEXT_SUPERSAMPLE = 4

const textRenderer: EntityRenderer = (e, env) => {
  const root = new Container()
  root.visible = env.textVisible
  const p = toContent(e.position)
  root.position.copyFrom(p)
  root.rotation = rad(e.rotation)
  const size = num(e.params.fontSize, 32)
  const sharpen = e.params.sharpenFonts !== false
  const color = hexToPixiColor(str(e.params.fontColor, "#000000"))
  const text = new Text({
    text: e.text ?? "",
    resolution: sharpen ? 2 : 1,
    style: {
      fontFamily: str(e.params.font, "") || "sans-serif",
      fontSize: size * TEXT_SUPERSAMPLE,
      fill: color.color,
      align: "center",
      wordWrap: e.params.textBox === true,
      wordWrapWidth: 6 * 64 * TEXT_SUPERSAMPLE,
    },
  })
  text.alpha = color.alpha
  text.anchor.set(0.5)
  // `fontSize` px at 100% zoom (64 px per tile) → tiles.
  text.scale.set(1 / (64 * TEXT_SUPERSAMPLE))
  root.addChild(text)
  return root
}

/** Renderers by tool id. Painted tools (cave, water, terrain, material) and lights are composited separately. */
/**
 * A light's glow: its falloff texture (the Style, or a soft default) tinted
 * with its color and added on top of the map, the way Godot's additive 2D
 * lights brighten what they touch even when the scene is fully lit. The
 * ambient darkness itself is the lighting composite (lighting.ts).
 */
const lightRenderer: EntityRenderer = (e, env) => {
  const root = new Container()
  root.visible = env.lighting
  const { id } = selectionAsset(e.params.style)
  const glow = new Sprite(env.tex(id) ?? lightFalloffTexture())
  glow.anchor.set(0.5)
  glow.position.copyFrom(toContent(e.position))
  const range = num(e.params.range, 5)
  glow.width = glow.height = range * 2
  glow.tint = hexToPixiColor(str(e.params.color, "#eccd8b")).color
  glow.alpha = Math.min(1, LIGHT_GLOW * num(e.params.intensity, 1))
  glow.blendMode = "add"
  root.addChild(glow)
  return root
}

/** Glow strength at intensity 1 (keeps a white-ambient map from washing out). */
export const LIGHT_GLOW = 0.45

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
