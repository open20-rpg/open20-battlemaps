import { create } from "zustand"
import { newId } from "../features/map/model/geometry"

/**
 * Tracks the on-disk identity of the currently open map: its path (null until
 * the first save/open), whether it has unsaved changes, and the creation
 * metadata carried into every save (`meta.createdAt`/`meta.appVersion` should
 * stay stable across re-saves — see `features/map/io.ts`).
 *
 * This is UI/session state, not part of the map document — it resets whenever
 * a map is created/opened/closed and is intentionally left out of undo/redo.
 */
interface MapFileState {
  path: string | null
  dirty: boolean
  createdAt: string | null
  /** App version the map was originally created with (kept across re-saves). */
  appVersion: string | null
  /**
   * The map's own id (`meta.id`, kept across saves and moves): what its
   * automatic backups are grouped by. Maps saved before it existed get one.
   */
  mapId: string | null
  /** A brand-new, never-saved map: no path yet, stamped with "now". */
  startNew: () => void
  /** A map just loaded from disk (or a backup): adopt its saved identity. */
  setLoaded: (
    path: string | null,
    createdAt: string,
    appVersion: string,
    mapId: string | undefined,
  ) => void
  /** A successful save: remember the path so the next Save reuses it. */
  setSaved: (path: string) => void
  clearFile: () => void
  markDirty: () => void
  markClean: () => void
}

export const useMapFileStore = create<MapFileState>()((set) => ({
  path: null,
  dirty: false,
  createdAt: null,
  appVersion: null,
  mapId: null,
  startNew: () =>
    set({
      path: null,
      dirty: false,
      createdAt: new Date().toISOString(),
      appVersion: __APP_VERSION__,
      mapId: newMapId(),
    }),
  setLoaded: (path, createdAt, appVersion, mapId) =>
    set({ path, dirty: false, createdAt, appVersion, mapId: usableMapId(mapId) ?? newMapId() }),
  setSaved: (path) => set({ path, dirty: false }),
  clearFile: () =>
    set({ path: null, dirty: false, createdAt: null, appVersion: null, mapId: null }),
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false }),
}))

const newMapId = () => newId("m")

/**
 * A map id read from a file, if it can name its backups' folder (the
 * backend accepts only these): anything else gets the map a new id.
 */
export function usableMapId(id: unknown): string | null {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

export const useMapDirty = (): boolean => useMapFileStore((s) => s.dirty)
export const useMapFilePath = (): string | null => useMapFileStore((s) => s.path)
