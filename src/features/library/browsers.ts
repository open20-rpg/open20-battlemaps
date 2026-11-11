import { getLibraryItems, type LibItem } from "./api"

/**
 * The library grids on screen, by category: what "next asset" (Shift+wheel
 * in Object/Scatter) steps through — the grid's own order, current search
 * included. useAssetSearch registers each grid while it's mounted.
 */
interface Browser {
  key: string
  items: Map<number, LibItem>
  total: number
}

const byCategory = new Map<string, Browser>()

export function registerLibraryBrowser(category: string, browser: Browser): () => void {
  byCategory.set(category, browser)
  return () => {
    if (byCategory.get(category) === browser) byCategory.delete(category)
  }
}

/** Index of `id` among a grid's loaded items (−1 if not loaded/found). */
export function indexOfAsset(items: ReadonlyMap<number, LibItem>, id: string | undefined): number {
  if (!id) return -1
  for (const [i, it] of items) if (it.id === id) return i
  return -1
}

/**
 * The asset `dir` steps from `currentId` in the grid of `category`
 * (wrapping around), fetching it if that page isn't loaded. Null when no
 * grid of the category is open or it's empty.
 */
export async function stepLibraryAsset(
  category: string,
  currentId: string | undefined,
  dir: 1 | -1,
): Promise<string | null> {
  const b = byCategory.get(category)
  if (!b || b.total === 0) return null
  const i = indexOfAsset(b.items, currentId)
  const next = i < 0 ? 0 : (i + dir + b.total) % b.total
  const known = b.items.get(next)
  if (known) return known.id
  const [item] = await getLibraryItems(b.key, next, 1)
  if (!item) return null
  b.items.set(next, item)
  return item.id
}
