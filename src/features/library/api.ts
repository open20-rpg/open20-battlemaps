import { invoke, convertFileSrc } from "@tauri-apps/api/core"

export interface LibItem {
  id: string
  name: string
  /** Absolute path to the thumbnail PNG. */
  thumb: string
  /** Absolute path to the full-size texture (for the hover preview). */
  full: string
  /**
   * Recolored by its red regions (a Colorable object, a "custom_color"
   * tileset) rather than tinted by the color.
   */
  colorable: boolean
  /** Default tint (walls and tilesets), from the pack's definitions. */
  defaultColor?: string | null
}

/** What a library search matches (mirrors `SearchFilter` in src-tauri). */
export interface SearchFilter {
  query: string
  /** 0 = fuzzy (subsequence) … 1 = exact substring. */
  exactness: number
  /** Scope the search to a single pack (omit for all enabled packs). */
  packId?: string
  /** Only textures in this pack tag (Library "Tags" tab). */
  tag?: string
  /** Only these asset ids (Library "Used" tab). */
  ids?: string[]
}

/**
 * Run a search over all enabled packs for the given category (e.g. "objects").
 * The backend caches the full result set under `key` (a per-browser id, so
 * several asset browsers can be open at once); only the total count is returned.
 */
export function searchLibrary(
  key: string,
  category: string,
  filter: SearchFilter,
): Promise<{ total: number }> {
  return invoke("search_library", { key, category, filter })
}

/** Tag names available for a category across enabled packs. */
export function libraryTags(category: string): Promise<string[]> {
  return invoke("library_tags", { category })
}

/** List enabled packs that ship textures for a category (for per-pack browsers). */
export function packsWithCategory(category: string): Promise<string[]> {
  return invoke("packs_with_category", { category })
}

/** Fetch a window of a browser instance's search results. */
export function getLibraryItems(key: string, offset: number, limit: number): Promise<LibItem[]> {
  return invoke("get_library_items", { key, offset, limit })
}

/** Free a browser instance's cached results (call when it unmounts). */
export function releaseLibrarySearch(key: string): Promise<void> {
  return invoke("release_library_search", { key })
}

/** Turn a thumbnail file path into an asset-protocol URL the webview can load. */
export function thumbUrl(path: string): string {
  return convertFileSrc(path)
}

/**
 * URL that serves the image recolored to `color` (hex, alpha optional) via the
 * `recolor://` protocol. Only use for colorable assets — the backend recolors
 * the red region; the URL is stable per (path,color) so the webview caches it.
 */
export function recolorUrl(path: string, color: string, mode: RecolorMode = "object"): string {
  const base = `${convertFileSrc(path, "recolor")}?color=${color.replace(/^#/, "")}`
  return mode === "object" ? base : `${base}&mode=${mode}`
}

/**
 * How an image is colored: one of two red-region recolors — objects', or
 * "custom_color" tilesets' and colorable patterns' — or a plain multiply (walls, "normal" tilesets).
 */
export type RecolorMode = "object" | "tileset" | "tint"

/** How a browser colors its thumbnails (see AssetSelector). */
export interface ThumbColoring {
  /** Multiply non-colorable thumbnails by the color (walls, tilesets). */
  tint: boolean
  /** The red-region recolor colorable ones get. */
  recolorMode: Exclude<RecolorMode, "tint">
}

const isWhite = (color: string) => /^#?f{6}(ff)?$/i.test(color)

/**
 * The URL to display for a library item. In tinted browsers (walls,
 * tilesets) each thumbnail shows in its own default color — never the color being picked — and "custom_color" ones as
 * they are. Elsewhere colorable ones are recolored by `color`.
 */
export function itemImageUrl(
  item: Pick<LibItem, "colorable" | "defaultColor">,
  path: string,
  color?: string,
  coloring: ThumbColoring = { tint: false, recolorMode: "object" },
): string {
  if (coloring.tint) {
    const own = item.defaultColor
    return !item.colorable && own && !isWhite(own) ? recolorUrl(path, own, "tint") : thumbUrl(path)
  }
  return item.colorable && color ? recolorUrl(path, color, coloring.recolorMode) : thumbUrl(path)
}
