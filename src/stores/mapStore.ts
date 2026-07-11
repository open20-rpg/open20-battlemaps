import { create } from "zustand"

/** The open map document. For now it only holds its dimensions in tiles. */
export interface MapDoc {
  width: number
  height: number
}

interface MapState {
  /**
   * The current document. Its existence drives UI affordances: the assets
   * panel becomes read-only and Save/Export become enabled while a map is
   * open. Mutations to the document itself go through the commands in
   * `features/map/commands` — never `set` from components.
   */
  map: MapDoc | null
  createMap: (width: number, height: number) => void
  closeMap: () => void
}

export const useMapStore = create<MapState>()((set) => ({
  map: null,
  createMap: (width, height) =>
    set({
      map: { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) },
    }),
  closeMap: () => set({ map: null }),
}))

export const useHasMap = (): boolean => useMapStore((s) => s.map !== null)
