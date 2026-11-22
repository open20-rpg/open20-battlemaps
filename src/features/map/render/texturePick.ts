import {
  pointInPolygon,
  spriteUV,
  wallRuns,
  type AssetSizeOf,
  type WallOpening,
} from "../model/geometry"
import { type MapEntity, type Vec2 } from "../model/types"
import {
  pathTriangles,
  pathWidths,
  smoothPath,
  wallTriangles,
  type LineTriangle,
} from "./lineGeometry"

/**
 * Where a point lands on an entity's texture, laid out exactly as its
 * renderer (entities.ts) lays it, so a click can go through the texture's
 * transparent pixels ("Click through transparency"). `u`/`v` are fractions
 * of the texture (0…1); `opacity` is the mesh's own there (a path's fades).
 */
export interface TextureHit {
  asset: string
  u: number
  v: number
  opacity: number
}

export interface TexturePicker {
  /**
   * The texture under `p`. `null`: off what's drawn (outside the sprite's
   * image, the path's strip, the pattern's shape); `undefined`: can't tell
   * there, so the shape decides.
   */
  at: (p: Vec2) => TextureHit | null | undefined
  /**
   * Lines only: points spread over their strip (with the texture at each),
   * for a rubber band to test. A grid over a long line's box would be too
   * coarse to land on a thin strip; these follow it at any length.
   */
  spread?: () => readonly { p: Vec2; hit: TextureHit }[]
}

/** Spacing (tiles) of a line's spread points. */
const SPREAD_STEP = 1 / 16

/** Most subdivisions of one triangle's side (very long straight walls). */
const SPREAD_MAX_STEPS = 64

const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback)
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
const firstAsset = (v: unknown) => str((v as { assets?: unknown[] } | undefined)?.assets?.[0])
/** Wrapped into 0…1: the texture repeats. */
const frac = (x: number) => x - Math.floor(x)

/** The openings `portals` cut into walls: as wide as each portal's texture. */
export function portalOpenings(portals: readonly MapEntity[], sizeOf: AssetSizeOf): WallOpening[] {
  return portals.map((p) => {
    const asset = str(p.params.asset)
    const w = ((asset ? sizeOf(asset)?.w : undefined) ?? 1) * (p.scale ?? 1)
    return { center: p.position, width: w }
  })
}

/** The line triangle under `p`, with its u, v and opacity interpolated there. */
export function lineUVAt(
  tris: readonly LineTriangle[],
  p: Vec2,
): { u: number; v: number; opacity: number } | null {
  // The last one drawn wins where the strip overlaps itself (tight bends).
  for (let i = tris.length - 1; i >= 0; i--) {
    const { a, b, c, alpha } = tris[i]
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
    if (Math.abs(det) < 1e-12) continue
    const wa = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det
    const wb = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det
    const wc = 1 - wa - wb
    const eps = -1e-9
    if (wa < eps || wb < eps || wc < eps) continue
    return {
      u: wa * a.u + wb * b.u + wc * c.u,
      v: wa * a.v + wb * b.v + wc * c.v,
      opacity: alpha,
    }
  }
  return null
}

/** Texture lookups along a line's triangles, `repeat` tiles per texture width. */
function linePicker(
  asset: string,
  tris: readonly LineTriangle[],
  repeat: number,
): Required<TexturePicker> {
  const hitOf = (u: number, v: number, opacity: number): TextureHit => ({
    asset,
    u: frac(u / repeat),
    v,
    opacity,
  })
  let spread: { p: Vec2; hit: TextureHit }[] | undefined
  return {
    at: (p) => {
      const hit = lineUVAt(tris, p)
      return hit && hitOf(hit.u, hit.v, hit.opacity)
    },
    spread: () => {
      if (spread) return spread
      spread = []
      for (const { a, b, c, alpha } of tris) {
        const side = Math.max(
          Math.hypot(b.x - a.x, b.y - a.y),
          Math.hypot(c.x - b.x, c.y - b.y),
          Math.hypot(a.x - c.x, a.y - c.y),
        )
        const n = Math.min(SPREAD_MAX_STEPS, Math.max(1, Math.ceil(side / SPREAD_STEP)))
        for (let i = 0; i <= n; i++) {
          for (let j = 0; i + j <= n; j++) {
            const [wa, wb] = [i / n, j / n]
            const wc = 1 - wa - wb
            const mix = (k: "x" | "y" | "u" | "v") => wa * a[k] + wb * b[k] + wc * c[k]
            spread.push({ p: { x: mix("x"), y: mix("y") }, hit: hitOf(mix("u"), mix("v"), alpha) })
          }
        }
      }
      return spread
    },
  }
}

/**
 * The texture picker of `entity` (its geometry built once, for the many
 * points a rubber band samples), or undefined when it has no texture to go
 * by: lights, texts, painted strokes, roofs, or a texture not loaded yet.
 * `portals` are its level's (they open walls).
 */
export function texturePicker(
  entity: MapEntity,
  sizeOf: AssetSizeOf,
  portals: readonly MapEntity[] = [],
): TexturePicker | undefined {
  const e = entity
  if (e.strokes || e.toolId === "text" || e.toolId === "light" || e.toolId === "roof") return
  if (!e.points) {
    // Sprites: objects, scatter, portals.
    const asset = str(e.params.asset)
    const size = asset && sizeOf(asset)
    if (!asset || !size) return
    return {
      at: (p) => {
        const { x: u, y: v } = spriteUV(e, p, size)
        return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { asset, u, v, opacity: 1 } : null
      },
    }
  }
  if (e.toolId === "path") {
    // As pathRenderer: Width × the texture's height, repeating at its aspect.
    const asset = str(e.params.asset)
    const size = asset && sizeOf(asset)
    if (!asset || !size) return
    const width = num(e.params.width, 1) * size.h
    const pts = smoothPath(e.points, num(e.params.smoothness, 0), !!e.closed)
    const tIn = e.params.transitionIn
    const tOut = e.params.transitionOut
    const widths = pathWidths(pts.length, width, tIn === "growth", tOut === "growth")
    const tris = pathTriangles(pts, widths, tIn === "fade", tOut === "fade")
    return linePicker(asset, tris, (width * size.w) / size.h)
  }
  if (e.toolId === "wall") {
    // As wallRenderer: as wide as the texture is tall, cut by the portals.
    const asset = firstAsset(e.params.wall)
    const size = asset && sizeOf(asset)
    if (!asset || !size) return
    const width = size.h
    const opts = { bevel: e.params.bevelCorners !== false, normalizeUv: true }
    const tris = wallRuns(e.points, !!e.closed, portalOpenings(portals, sizeOf)).flatMap((run) =>
      wallTriangles(run.points, run.closed, width, opts),
    )
    const line = linePicker(asset, tris, size.w)
    // Off the strip, a click is on its end caps (another texture) or the
    // reach around it: the shape decides.
    return { ...line, at: (p) => line.at(p) ?? undefined }
  }
  if (e.toolId === "pattern" || e.toolId === "build") {
    // As tiledPolygon: tiled from the position, turned with the shape (and
    // a pattern's Rotation), in content space (x mirrored).
    const pattern = e.toolId === "pattern"
    const asset = firstAsset(pattern ? e.params.pattern : e.params.floor)
    const size = asset && sizeOf(asset)
    const poly = e.points
    if (!asset || !size || poly.length < 3) return
    const t = ((e.rotation + (pattern ? num(e.params.rotation, 0) : 0)) * Math.PI) / 180
    const cos = Math.cos(t)
    const sin = Math.sin(t)
    return {
      at: (p) => {
        if (!pointInPolygon(p, poly)) return null
        const dx = -p.x + e.position.x
        const dy = p.y - e.position.y
        return {
          asset,
          u: frac((dx * cos + dy * sin) / size.w),
          v: frac((-dx * sin + dy * cos) / size.h),
          opacity: 1,
        }
      },
    }
  }
  return
}
