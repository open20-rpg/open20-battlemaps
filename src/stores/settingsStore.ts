import { create } from "zustand"
import { persist } from "zustand/middleware"
import { loadUserPresets } from "../lib/colors"
import { loadUserTemplates, type MapTemplate } from "../lib/templates"
import { type MapEntity } from "../features/map/model/types"

/** A saved group of entities (Prefabs tool), stored relative to its center. */
export interface Prefab {
  id: string
  /** User-given name; empty means unnamed (the UI shows a numbered label). */
  name: string
  entities: MapEntity[]
}

/**
 * How drop shadows (objects, walls) look in OpenDraft. An app preference, not
 * part of any map file: Dungeondraft maps have no such settings.
 */
export interface ShadowStyle {
  /** Softness: blur radius in tiles (0 = hard edge). */
  blur: number
  /** Offset in tiles, on screen (+x right, +y down). */
  offsetX: number
  offsetY: number
  /** 0..1 */
  opacity: number
}

export const DEFAULT_SHADOW_STYLE: ShadowStyle = {
  blur: 0.04,
  offsetX: 0.06,
  offsetY: 0.08,
  opacity: 0.35,
}

/** How many recently opened/saved map paths to remember. */
export const MAX_RECENT_MAPS = 10

/**
 * User preferences and user-created data, persisted under a single versioned
 * localStorage key. All localStorage access goes through this store — never
 * read/write keys directly from components.
 */
interface SettingsState {
  /** Panel translucency, 0.3..1 (applied to the --panel-alpha CSS var). */
  panelAlpha: number
  /** User-added color presets (shown after the built-in ones). */
  colorPresets: string[]
  /** User-defined map templates (shown after the built-in ones). */
  userTemplates: MapTemplate[]
  /** Saved prefabs, reusable across maps. */
  prefabs: Prefab[]
  /** Recently opened/saved map files (most recent first). */
  recentMaps: string[]
  shadowStyle: ShadowStyle
  setShadowStyle: (patch: Partial<ShadowStyle>) => void
  resetShadowStyle: () => void
  setPanelAlpha: (alpha: number) => void
  addColorPreset: (color: string) => void
  addTemplate: (tpl: MapTemplate) => void
  removeTemplate: (id: string) => void
  addPrefab: (prefab: Prefab) => void
  renamePrefab: (id: string, name: string) => void
  removePrefab: (id: string) => void
  /** Move `path` to the top of the recent list. */
  pushRecentMap: (path: string) => void
  removeRecentMap: (path: string) => void
}

/**
 * Seed defaults from the pre-store localStorage keys (panel-alpha, color
 * presets, user templates) so existing users keep their data. The persisted
 * store value, when present, overrides these on rehydration.
 */
function readLegacy(): Partial<
  Pick<SettingsState, "panelAlpha" | "colorPresets" | "userTemplates">
> {
  const out: ReturnType<typeof readLegacy> = {}
  // No storage outside a browser (e.g. unit tests): nothing to migrate.
  if (typeof localStorage === "undefined") return out
  const alpha = Number(localStorage.getItem("opendraft.panel-alpha"))
  if (Number.isFinite(alpha) && alpha > 0) out.panelAlpha = alpha
  const presets = loadUserPresets()
  if (presets.length > 0) out.colorPresets = presets
  const templates = loadUserTemplates()
  if (templates.length > 0) out.userTemplates = templates
  return out
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      panelAlpha: 0.8,
      colorPresets: [],
      userTemplates: [],
      prefabs: [],
      recentMaps: [],
      shadowStyle: DEFAULT_SHADOW_STYLE,
      setShadowStyle: (patch) => set((s) => ({ shadowStyle: { ...s.shadowStyle, ...patch } })),
      resetShadowStyle: () => set({ shadowStyle: DEFAULT_SHADOW_STYLE }),
      ...readLegacy(),
      setPanelAlpha: (panelAlpha) => set({ panelAlpha }),
      addColorPreset: (color) =>
        set((s) =>
          s.colorPresets.includes(color) ? s : { colorPresets: [...s.colorPresets, color] },
        ),
      addTemplate: (tpl) => set((s) => ({ userTemplates: [...s.userTemplates, tpl] })),
      removeTemplate: (id) =>
        set((s) => ({ userTemplates: s.userTemplates.filter((t) => t.id !== id) })),
      addPrefab: (prefab) => set((s) => ({ prefabs: [...s.prefabs, prefab] })),
      renamePrefab: (id, name) =>
        set((s) => ({ prefabs: s.prefabs.map((p) => (p.id === id ? { ...p, name } : p)) })),
      removePrefab: (id) => set((s) => ({ prefabs: s.prefabs.filter((p) => p.id !== id) })),
      pushRecentMap: (path) =>
        set((s) => ({
          recentMaps: [path, ...s.recentMaps.filter((p) => p !== path)].slice(0, MAX_RECENT_MAPS),
        })),
      removeRecentMap: (path) =>
        set((s) => ({ recentMaps: s.recentMaps.filter((p) => p !== path) })),
    }),
    { name: "opendraft.settings", version: 1 },
  ),
)
