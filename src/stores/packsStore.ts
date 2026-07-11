import { create } from "zustand"
import i18n from "../i18n"
import { listInstalled, type InstalledPack } from "../features/packs/api"
import { withLoading } from "./loadingStore"

interface PacksState {
  /**
   * Cached installed-pack list for the whole app. The list is lightweight
   * (manifest + cached stats), so it's loaded once and only refreshed on
   * demand — closing/reopening the assets window never re-reads disk.
   */
  packs: InstalledPack[]
  /** True while a (re)load is in flight. */
  loading: boolean
  /** True once the list has been loaded at least once this session. */
  loaded: boolean
  /** Load the list if it hasn't been loaded yet (cheap no-op otherwise). */
  ensureLoaded: () => void
  /** Force a reload from disk (the refresh button). */
  refresh: () => Promise<void>
  /** Merge freshly installed packs into the cache without a reload. */
  addOrUpdate: (items: InstalledPack[]) => void
  /** Flip enabled state in the cache without a reload. */
  applyEnabled: (ids: string[], enabled: boolean) => void
  /** Drop uninstalled packs from the cache without a reload. */
  removePacks: (ids: string[]) => void
}

const byName = (a: InstalledPack, b: InstalledPack) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase())

// Coalesce concurrent refreshes into one in-flight request.
let inFlight: Promise<void> | null = null

export const usePacksStore = create<PacksState>()((set, get) => ({
  packs: [],
  loading: false,
  loaded: false,

  refresh: () => {
    if (inFlight) return inFlight
    set({ loading: true })
    inFlight = withLoading(i18n.t("loading.loadingAssets"), async () => {
      const list = await listInstalled()
      set({ packs: list, loaded: true })
    }).finally(() => {
      inFlight = null
      set({ loading: false })
    })
    return inFlight
  },

  ensureLoaded: () => {
    if (!get().loaded && !inFlight) void get().refresh()
  },

  addOrUpdate: (items) =>
    set((s) => {
      const map = new Map(s.packs.map((p) => [p.id, p]))
      for (const it of items) map.set(it.id, it)
      return { packs: [...map.values()].sort(byName) }
    }),

  applyEnabled: (ids, enabled) => {
    const setIds = new Set(ids)
    set((s) => ({ packs: s.packs.map((p) => (setIds.has(p.id) ? { ...p, enabled } : p)) }))
  },

  removePacks: (ids) => {
    const setIds = new Set(ids)
    set((s) => ({ packs: s.packs.filter((p) => !setIds.has(p.id)) }))
  },
}))
