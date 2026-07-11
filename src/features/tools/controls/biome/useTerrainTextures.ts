import { useEffect, useMemo, useState } from "react"
import { usePacksStore } from "../../../../stores/packsStore"
import {
  getLibraryItems,
  releaseLibrarySearch,
  searchLibrary,
  type LibItem,
} from "../../../library/api"

/** Terrain textures of one installed pack. */
export interface TerrainPack {
  id: string
  name: string
  items: LibItem[]
}

const BROWSER_KEY = "biome-terrain-picker"

/** Split a library item id ("{packId}|{relPath}") into its pack id. */
function packIdOf(itemId: string): string {
  const sep = itemId.indexOf("|")
  return sep >= 0 ? itemId.slice(0, sep) : itemId
}

/**
 * Loads every terrain texture across enabled packs (once, on mount) and groups
 * them by the pack that ships them. Mount this only while the picker is open.
 */
export function useTerrainTextures(): { loading: boolean; packs: TerrainPack[] } {
  const installed = usePacksStore((s) => s.packs)
  // Starts loading; the async load flips it off (no synchronous setState here).
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<LibItem[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { total } = await searchLibrary(BROWSER_KEY, "terrain", "", 1)
      const list = total > 0 ? await getLibraryItems(BROWSER_KEY, 0, total) : []
      if (!cancelled) {
        setItems(list)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      void releaseLibrarySearch(BROWSER_KEY)
    }
  }, [])

  const packs = useMemo(() => {
    const nameById = new Map(installed.map((p) => [p.id, p.name]))
    const groups = new Map<string, TerrainPack>()
    for (const item of items) {
      const id = packIdOf(item.id)
      let group = groups.get(id)
      if (!group) {
        group = { id, name: nameById.get(id) ?? id, items: [] }
        groups.set(id, group)
      }
      group.items.push(item)
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [items, installed])

  return { loading, packs }
}
