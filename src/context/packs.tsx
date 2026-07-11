import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import { listInstalled, type InstalledPack } from "../lib/packs"
import { useLoading } from "./loading"

interface PacksContextValue {
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

const PacksContext = createContext<PacksContextValue | null>(null)

const byName = (a: InstalledPack, b: InstalledPack) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase())

/**
 * Caches the installed-pack list for the whole app. The list is lightweight
 * (manifest + cached stats), so it's loaded once and only refreshed on demand.
 * Living above the assets window means closing/reopening it never re-reads disk.
 */
export function PacksProvider({ children }: { children: ReactNode }) {
  const { withLoading } = useLoading()
  const { t } = useTranslation()
  const tRef = useRef(t)
  tRef.current = t

  const [packs, setPacks] = useState<InstalledPack[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const inFlight = useRef<Promise<void> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await withLoading(tRef.current("loading.loadingAssets"), async () => {
        const list = await listInstalled()
        setPacks(list)
        setLoaded(true)
      })
    } finally {
      setLoading(false)
    }
  }, [withLoading])

  const refresh = useCallback(() => {
    // Coalesce concurrent refreshes into one in-flight request.
    if (inFlight.current) return inFlight.current
    const p = load().finally(() => {
      inFlight.current = null
    })
    inFlight.current = p
    return p
  }, [load])

  const ensureLoaded = useCallback(() => {
    if (!loaded && !inFlight.current) void refresh()
  }, [loaded, refresh])

  const addOrUpdate = useCallback((items: InstalledPack[]) => {
    setPacks((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]))
      for (const it of items) map.set(it.id, it)
      return [...map.values()].sort(byName)
    })
  }, [])

  const applyEnabled = useCallback((ids: string[], enabled: boolean) => {
    const set = new Set(ids)
    setPacks((prev) => prev.map((p) => (set.has(p.id) ? { ...p, enabled } : p)))
  }, [])

  const removePacks = useCallback((ids: string[]) => {
    const set = new Set(ids)
    setPacks((prev) => prev.filter((p) => !set.has(p.id)))
  }, [])

  const value = useMemo<PacksContextValue>(
    () => ({
      packs,
      loading,
      loaded,
      ensureLoaded,
      refresh,
      addOrUpdate,
      applyEnabled,
      removePacks,
    }),
    [packs, loading, loaded, ensureLoaded, refresh, addOrUpdate, applyEnabled, removePacks],
  )

  return <PacksContext.Provider value={value}>{children}</PacksContext.Provider>
}

export function usePacks(): PacksContextValue {
  const ctx = useContext(PacksContext)
  if (!ctx) {
    throw new Error("usePacks must be used within a <PacksProvider>")
  }
  return ctx
}
