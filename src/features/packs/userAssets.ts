import { type AssetCategory } from "../../lib/categories"

/**
 * What the user adjusts on an image before it goes into a pack (mirrors
 * `Adjust` in src-tauri/src/pack/optimize.rs).
 */
export interface Adjust {
  /** Resize factor (1 = as is). */
  scale: number
  /** Quarter turns clockwise (0–3). */
  rotate: number
  flipH: boolean
  flipV: boolean
  /** Cut fully transparent borders. */
  trim: boolean
}

export const NO_ADJUST: Adjust = { scale: 1, rotate: 0, flipH: false, flipV: false, trim: false }

/** Pack textures are authored at 256 px per grid cell. */
export const PX_PER_CELL = 256

/** How each category's items are made (mirrors `layout` in userpack.rs). */
export interface CategorySpec {
  /** Extra textures an item may come with (a wall's end cap, a cave's wall…). */
  parts: readonly string[]
  /** Whether it can be colorable (red regions recolored by the tool's color). */
  colorable: boolean
  /** Whether it has a default tint (walls, floors). */
  color: boolean
  /** Whether it can go in a subfolder (objects). */
  folder: boolean
  /** Whether transparent borders are cut by default (things placed whole). */
  trim: boolean
}

export const CATEGORY_SPECS: Record<AssetCategory, CategorySpec> = {
  objects: { parts: [], colorable: true, color: false, folder: true, trim: true },
  portals: { parts: [], colorable: true, color: false, folder: false, trim: true },
  paths: { parts: [], colorable: true, color: false, folder: false, trim: false },
  lights: { parts: [], colorable: false, color: false, folder: false, trim: false },
  terrain: { parts: [], colorable: false, color: false, folder: false, trim: false },
  tilesets: { parts: [], colorable: true, color: true, folder: false, trim: false },
  walls: { parts: ["end"], colorable: false, color: true, folder: false, trim: false },
  materials: { parts: ["border"], colorable: false, color: false, folder: false, trim: false },
  caves: { parts: ["wall"], colorable: false, color: false, folder: false, trim: false },
  roofs: {
    parts: ["edge", "hip", "ridge"],
    colorable: false,
    color: false,
    folder: false,
    trim: false,
  },
}

/** Categories in the order the import window lists them. */
export const IMPORT_CATEGORIES: readonly AssetCategory[] = [
  "objects",
  "portals",
  "paths",
  "lights",
  "terrain",
  "tilesets",
  "walls",
  "materials",
  "caves",
  "roofs",
]

/** The last path segment of a picked file (a path, or an Android `content://` URI). */
export function fileName(source: string): string {
  let s = source
  try {
    s = decodeURIComponent(source)
  } catch {
    // Not URI-encoded: use it as is.
  }
  const seg = s.split(/[/\\]/).pop() ?? s
  // SAF document ids look like "primary:Pictures/chair.png".
  return seg.split(":").pop() ?? seg
}

/** The folder a picked file is in (its name only), if any. */
function parentName(source: string): string {
  let s = source
  try {
    s = decodeURIComponent(source)
  } catch {
    // Not URI-encoded.
  }
  const parts = s.split(/[/\\:]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ""
}

const stemOf = (name: string) => name.replace(/\.[^.]+$/, "")

/** A readable asset name from a file name: `wooden_chair-02.png` → `Wooden chair 02`. */
export function nameFromFile(source: string): string {
  const words = stemOf(fileName(source)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()
  if (!words) return "Asset"
  return words[0].toUpperCase() + words.slice(1)
}

/** One image (and its parts) about to be imported. */
export interface ImportGroup {
  source: string
  name: string
  /** Part name → image. */
  parts: Record<string, string>
}

/** `name` split into (base, part) when it ends with one of `parts` (`stone_end` → stone, end). */
function splitPart(stem: string, parts: readonly string[]): [string, string] | null {
  const lower = stem.toLowerCase()
  for (const part of parts) {
    for (const sep of ["_", "-", " "]) {
      const suffix = `${sep}${part}`
      if (lower.endsWith(suffix)) return [stem.slice(0, -suffix.length), part]
    }
    if (lower === part) return ["", part]
  }
  return null
}

/** The main texture's own marker, which is dropped from its name. */
const MAIN_MARKER: Partial<Record<AssetCategory, string>> = {
  materials: "tile",
  caves: "floor",
  roofs: "tiles",
}

/**
 * Turn picked files into import items, pairing each category's part images
 * with their main one by the names Dungeondraft packs use: `stone_end.png`
 * goes with `stone.png` (walls), `grass_border` with `grass_tile`
 * (materials), and `wall`/`edge`… with the `floor`/`tiles` beside them
 * (caves, roofs: same folder, or the same name prefix). A part that finds no
 * main image is imported as an item of its own.
 */
export function groupFiles(sources: readonly string[], category: AssetCategory): ImportGroup[] {
  const spec = CATEGORY_SPECS[category]
  const marker = MAIN_MARKER[category]
  if (spec.parts.length === 0) {
    return sources.map((source) => ({ source, name: nameFromFile(source), parts: {} }))
  }
  // Key an image by its base name (lowercase) and folder.
  const keyOf = (source: string, base: string) =>
    `${parentName(source).toLowerCase()}|${base.toLowerCase().trim()}`
  const mains = new Map<string, ImportGroup>()
  const order: ImportGroup[] = []
  const loose: { source: string; key: string; part: string }[] = []
  for (const source of sources) {
    const stem = stemOf(fileName(source))
    const asPart = splitPart(stem, spec.parts)
    if (asPart) {
      loose.push({ source, key: keyOf(source, asPart[0]), part: asPart[1] })
      continue
    }
    const asMain = marker ? splitPart(stem, [marker]) : null
    const base = asMain ? asMain[0] : stem
    // A bare "floor.png"/"tiles.png" is named after its folder.
    const name = base ? nameFromFile(base) : nameFromFile(parentName(source)) || nameFromFile(stem)
    const group: ImportGroup = { source, name, parts: {} }
    mains.set(keyOf(source, base), group)
    order.push(group)
  }
  for (const { source, key, part } of loose) {
    const main = mains.get(key)
    if (main && !main.parts[part]) main.parts[part] = source
    else order.push({ source, name: nameFromFile(source), parts: {} })
  }
  return order
}

/** Size in px an image ends up with (mirrors `target_size` in optimize.rs). */
export function targetSize(
  width: number,
  height: number,
  adjust: Adjust,
  bounds?: readonly [number, number, number, number] | null,
): { w: number; h: number } {
  const [bw, bh] = adjust.trim && bounds ? [bounds[2], bounds[3]] : [width, height]
  const [w, h] = adjust.rotate % 2 === 1 ? [bh, bw] : [bw, bh]
  const scale = Math.min(16, Math.max(0.01, adjust.scale))
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/** Grid cells a size in px covers, rounded for display. */
export function cellsOf(px: number): number {
  return Math.round((px / PX_PER_CELL) * 100) / 100
}

/** The scale that makes `px` cover `cells` grid cells. */
export function scaleForCells(px: number, cells: number): number {
  return px > 0 ? (cells * PX_PER_CELL) / px : 1
}

/** The value every item shares, or `undefined` when they differ ("mixed"). */
export function sharedValue<T, V>(items: readonly T[], get: (item: T) => V): V | undefined {
  if (items.length === 0) return undefined
  const first = get(items[0])
  const key = JSON.stringify(first)
  return items.every((it) => JSON.stringify(get(it)) === key) ? first : undefined
}

/** Category of a user asset id (`<pack>|textures/<category>/…`). */
export function categoryOfAssetId(id: string): AssetCategory | null {
  const rel = id.split("|")[1] ?? ""
  const cat = rel.split("/")[1]
  return IMPORT_CATEGORIES.includes(cat as AssetCategory) ? (cat as AssetCategory) : null
}

/** Tags typed as "a, b ,c" → ["a", "b", "c"] (deduplicated, empties dropped). */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ]
}
