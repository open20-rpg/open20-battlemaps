import { invoke, convertFileSrc } from "@tauri-apps/api/core"

export interface LibItem {
  id: string
  name: string
  /** Absolute path to the thumbnail PNG. */
  thumb: string
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
