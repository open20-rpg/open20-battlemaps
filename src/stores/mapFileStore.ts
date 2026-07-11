import { create } from "zustand"

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
  /** A brand-new, never-saved map: no path yet, stamped with "now". */
  startNew: () => void
  /** A map just loaded from disk: adopt its saved identity. */
  setLoaded: (path: string, createdAt: string, appVersion: string) => void
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
  startNew: () =>
    set({
      path: null,
      dirty: false,
      createdAt: new Date().toISOString(),
      appVersion: __APP_VERSION__,
    }),
  setLoaded: (path, createdAt, appVersion) => set({ path, dirty: false, createdAt, appVersion }),
  setSaved: (path) => set({ path, dirty: false }),
  clearFile: () => set({ path: null, dirty: false, createdAt: null, appVersion: null }),
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false }),
}))

export const useMapDirty = (): boolean => useMapFileStore((s) => s.dirty)
export const useMapFilePath = (): string | null => useMapFileStore((s) => s.path)
