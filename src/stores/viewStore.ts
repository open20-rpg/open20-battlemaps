import { create } from "zustand"
import { persist } from "zustand/middleware"

/** The boolean view toggles surfaced by the view-controls bar. */
export type ViewToggleKey = "grid" | "snap" | "lighting" | "shadows"

/**
 * Viewport display state: the on/off overlays (grid, snap, lighting) and the
 * current zoom level. This is UI/view state — it drives how the editor is
 * rendered, not the map document, so it lives outside the undo/redo history and
 * persists across sessions. The real canvas will read these once it exists.
 */
interface ViewState {
  grid: boolean
  snap: boolean
  lighting: boolean
  shadows: boolean
  /** Zoom as a whole percentage (one of ZOOM_LEVELS). */
  zoom: number
  toggle: (key: ViewToggleKey) => void
  setZoom: (zoom: number) => void
}

export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      grid: true,
      snap: true,
      lighting: true,
      shadows: true,
      zoom: 100,
      toggle: (key) => set((s) => ({ [key]: !s[key] }) as Partial<ViewState>),
      setZoom: (zoom) => set({ zoom }),
    }),
    { name: "opendraft.view", version: 1 },
  ),
)
