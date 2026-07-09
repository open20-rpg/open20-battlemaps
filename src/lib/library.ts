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

/**
 * Run a search over all enabled packs for the given category (e.g. "objects").
 * The backend caches the full result set; only the total count is returned.
 */
export function searchLibrary(
  category: string,
  query: string,
  exactness: number,
): Promise<{ total: number }> {
  return invoke("search_library", { category, query, exactness })
}

/** Fetch a window of the current search results. */
export function getLibraryItems(offset: number, limit: number): Promise<LibItem[]> {
  return invoke("get_library_items", { offset, limit })
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
