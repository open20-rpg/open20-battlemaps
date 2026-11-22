import { type Entity, type Vec2 } from "@open20/battlemaps-sdk"

/**
 * The `.n21map` format: what Nivel21 (the Nivel20 browser extension) loads
 * as a scene. Plain JSON so Nivel21 needs no library to read it:
 *
 * - `grid`: the map's size in cells (one Battle Maps tile = one Nivel20 cell).
 * - `background`: the map drawn without objects (terrain, floors, walls,
 *   doors…), PNG in base64.
 * - `images` + `tokens`: each object as a token (its image once, then where
 *   each copy goes, in cells from the image's top-left corner, its center).
 * - `walls`: fog-of-war segments in the same cells; doors and windows are
 *   their own segments so the DM can remove just that one to open it.
 */
export const N21_FORMAT = "open20.n21map"
export const N21_VERSION = 1

export type WallKind = "wall" | "door" | "window"

export interface N21Wall {
  x1: number
  y1: number
  x2: number
  y2: number
  kind: WallKind
}

export interface N21Token {
  image: string
  name: string
  /** Center, in cells from the image's top-left corner. */
  x: number
  y: number
  /** Footprint in cells (of the image as drawn, rotation included). */
  width: number
  height: number
  /** Degrees clockwise; 0 when the image was already turned (`baked`). */
  rotation: number
}

export interface N21Map {
  format: typeof N21_FORMAT
  version: number
  name: string
  grid: { width: number; height: number; pxPerCell: number; cellDistance: number; unit: string }
  background: { mime: string; data: string; width: number; height: number }
  images: Record<string, { name: string; mime: string; data: string }>
  tokens: N21Token[]
  walls: N21Wall[]
}

/** Pixels per Battle Maps tile in pack textures (asset size = px / this). */
export const TEXTURE_PX_PER_TILE = 256

/** "pack|textures/objects/wooden_barrel_02.png" → "Wooden barrel 02". */
export function assetLabel(id: string | undefined): string {
  const file = (id ?? "").split("|").pop()?.split("/").pop() ?? ""
  const base = file
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Objeto"
}

/** Pixel size of a PNG, WebP or JPEG from its header (null if unknown). */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
  const u16le = (o: number) => b[o] | (b[o + 1] << 8)
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return { width: u32(16), height: u32(20) }
  if (
    b.length >= 30 &&
    String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.subarray(8, 12)) === "WEBP"
  ) {
    const chunk = String.fromCharCode(...b.subarray(12, 16))
    if (chunk === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff }
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === "VP8X")
      return {
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null
      const marker = b[o + 1]
      const len = (b[o + 2] << 8) | b[o + 3]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { height: (b[o + 5] << 8) | b[o + 6], width: (b[o + 7] << 8) | b[o + 8] }
      o += 2 + len
    }
  }
  return null
}

/** Size in tiles of an entity's image at its scale (1×1 when unknown). */
export function tilesOf(
  px: { width: number; height: number } | null,
  scale: number,
): { w: number; h: number } {
  if (!px) return { w: scale, h: scale }
  return {
    w: (px.width / TEXTURE_PX_PER_TILE) * scale,
    h: (px.height / TEXTURE_PX_PER_TILE) * scale,
  }
}

/** Bounding box of a w × h box turned by `deg`. */
export function rotatedSize(w: number, h: number, deg: number): { w: number; h: number } {
  const r = (deg * Math.PI) / 180
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  return { w: w * c + h * s, h: w * s + h * c }
}

/**
 * Battle Maps' map x is mirrored (x = 0 is the right edge, as in
 * Dungeondraft); images and Nivel20 count from the left. This turns a map
 * point into cells from the image's top-left corner.
 */
export const toImageSpace = (p: Vec2, mapWidth: number): Vec2 => ({ x: mapWidth - p.x, y: p.y })

const round = (v: number) => Math.round(v * 1000) / 1000

/** A portal's kind for the fog: windows by their name, everything else a door. */
export function portalKind(asset: string | undefined): WallKind {
  return /window|ventana|ventanal/i.test(asset ?? "") ? "window" : "door"
}

export interface PortalCut {
  position: Vec2
  /** Width along the wall, in tiles. */
  width: number
  kind: WallKind
}

/** How far (tiles) from a wall a portal may sit and still cut it. */
const PORTAL_REACH = 0.35

/**
 * One wall polyline as fog segments: plain wall where it's solid, and a
 * segment of the portal's kind where a door or window sits on it, so the
 * opening can be removed on its own. Points are in map tiles.
 */
export function wallSegments(
  points: readonly Vec2[],
  closed: boolean,
  portals: readonly PortalCut[],
): { a: Vec2; b: Vec2; kind: WallKind }[] {
  const out: { a: Vec2; b: Vec2; kind: WallKind }[] = []
  const n = points.length
  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1e-6) continue
    const dx = (b.x - a.x) / len
    const dy = (b.y - a.y) / len
    // Openings along this segment: [from, to] distances from a.
    const cuts: { from: number; to: number; kind: WallKind }[] = []
    for (const p of portals) {
      const t = (p.position.x - a.x) * dx + (p.position.y - a.y) * dy
      const off = Math.abs((p.position.x - a.x) * dy - (p.position.y - a.y) * dx)
      if (off > PORTAL_REACH || t < -p.width / 2 || t > len + p.width / 2) continue
      const from = Math.max(0, t - p.width / 2)
      const to = Math.min(len, t + p.width / 2)
      if (to - from > 1e-3) cuts.push({ from, to, kind: p.kind })
    }
    cuts.sort((x, y) => x.from - y.from)
    const at = (d: number) => ({ x: a.x + dx * d, y: a.y + dy * d })
    let cursor = 0
    for (const c of cuts) {
      const from = Math.max(c.from, cursor)
      if (c.to <= from) continue
      if (from > cursor + 1e-3) out.push({ a: at(cursor), b: at(from), kind: "wall" })
      out.push({ a: at(from), b: at(c.to), kind: c.kind })
      cursor = c.to
    }
    if (len > cursor + 1e-3) out.push({ a: at(cursor), b, kind: "wall" })
  }
  return out
}

/** Every wall of the map as N21 segments (image space, cells), cut by its portals. */
export function mapWalls(
  walls: readonly Entity[],
  portals: readonly PortalCut[],
  mapWidth: number,
): N21Wall[] {
  return walls.flatMap((w) =>
    wallSegments(w.points ?? [], !!w.closed, portals).map((s) => {
      const a = toImageSpace(s.a, mapWidth)
      const b = toImageSpace(s.b, mapWidth)
      return { x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y), kind: s.kind }
    }),
  )
}

/** A key for an object's image as drawn (same asset, turn and mirror: one image). */
export const imageKey = (asset: string, rotation: number, flipX: boolean, flipY: boolean): string =>
  `${asset}#${Math.round(rotation)}${flipX ? "x" : ""}${flipY ? "y" : ""}`

/** Base64 of bytes, in chunks (big images can't go through one call). */
export function toBase64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Whether a parsed value is an N21 map this version can read (for Nivel21 and tests). */
export function isN21Map(v: unknown): v is N21Map {
  const m = v as N21Map
  return (
    !!m &&
    m.format === N21_FORMAT &&
    typeof m.version === "number" &&
    !!m.grid &&
    !!m.background &&
    Array.isArray(m.tokens) &&
    Array.isArray(m.walls)
  )
}
