import { create } from "zustand"
import { temporal } from "zundo"
import { type MapDocument } from "../features/map/model/types"

interface MapState {
  /**
   * The current document, or null when no map is open. Its existence drives
   * UI affordances: the assets panel becomes read-only and Save/Export become
   * enabled while a map is open.
   *
   * The document is mutated ONLY through the commands in
   * `features/map/commands` — never `setState` from components. Commands are
   * what the undo/redo history tracks.
   */
  map: MapDocument | null
}

export const useMapStore = create<MapState>()(
  temporal((): MapState => ({ map: null }), {
    // Only the document takes part in undo/redo.
    partialize: (s) => ({ map: s.map }),
  }),
)

export const useHasMap = (): boolean => useMapStore((s) => s.map !== null)
