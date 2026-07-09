import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

/** The open map document. For now it only holds its dimensions in tiles. */
export interface MapDoc {
  width: number
  height: number
}

interface MapContextValue {
  map: MapDoc | null
  hasMap: boolean
  /** Create (or replace) the current map with the given tile dimensions. */
  createMap: (width: number, height: number) => void
  closeMap: () => void
}

const MapContext = createContext<MapContextValue | null>(null)

/**
 * Holds the current map state. Its existence drives UI affordances: the assets
 * panel becomes read-only and Save/Export/Undo/Redo become enabled while a map
 * is open. No visual map representation yet — only the state.
 */
export function MapProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<MapDoc | null>({ width: 35, height: 20 })

  const createMap = useCallback((width: number, height: number) => {
    setMap({ width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) })
  }, [])

  const closeMap = useCallback(() => setMap(null), [])

  const value = useMemo<MapContextValue>(
    () => ({ map, hasMap: map !== null, createMap, closeMap }),
    [map, createMap, closeMap],
  )

  return <MapContext.Provider value={value}>{children}</MapContext.Provider>
}

export function useMap(): MapContextValue {
  const ctx = useContext(MapContext)
  if (!ctx) {
    throw new Error("useMap must be used within a <MapProvider>")
  }
  return ctx
}
