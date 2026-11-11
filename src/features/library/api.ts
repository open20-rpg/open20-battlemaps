import { invoke, convertFileSrc } from "@tauri-apps/api/core"

export interface LibItem {
  id: string
  name: string
  /** Absolute path to the thumbnail PNG. */
  thumb: string
  /** Absolute path to the full-size texture (for the hover preview). */
  full: string
  /** Whether this asset can be recolored (tagged Colorable + pack enables it). */
  colorable: boolean
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
export function recolorUrl(path: string, color: string): string {
  return `${convertFileSrc(path, "recolor")}?color=${color.replace(/^#/, "")}`
}

/** The URL to display for a library item, recolored if colorable + a color is set. */
export function itemImageUrl(path: string, colorable: boolean, color?: string): string {
  return colorable && color ? recolorUrl(path, color) : thumbUrl(path)
}
