import { create } from "zustand"
import { DEFAULT_POST_PROCESS, type PostProcess } from "../lib/postProcess"
import { knownPreset, type PresetId } from "../features/shortcuts/actions"
import { persist } from "zustand/middleware"
import { type MapTemplate } from "../lib/templates"
import { type MapEntity } from "../features/map/model/types"
import { isMobilePlatform } from "../lib/platform"

/** A saved group of entities (Prefabs tool), stored relative to its center. */
export interface Prefab {
  id: string
  /** User-given name; empty means unnamed (the UI shows a numbered label). */
  name: string
  entities: MapEntity[]
}

/**
 * How drop shadows (objects, walls) look in Open20 Battle Maps. An app preference, not
 * part of any map file (imported maps have no such settings either).
 */
export interface ShadowStyle {
  /** Softness: blur radius in tiles (0 = hard edge). */
  blur: number
  /** Offset in tiles, on screen (+x right, +y down). */
  offsetX: number
  offsetY: number
  /** 0..1 */
  opacity: number
  /** Shadow color ("#rrggbb"). */
  color: string
  /** Softness of the shadows lights cast past walls: blur in tiles (0 = hard edge). */
  lightSoftness: number
  /** Which things cast shadows (each still needs its own Shadow switch on). */
  objects: boolean
  walls: boolean
  portals: boolean
  paths: boolean
  patterns: boolean
  roofs: boolean
}

export const DEFAULT_SHADOW_STYLE: ShadowStyle = {
  blur: 0.04,
  offsetX: 0.06,
  offsetY: 0.08,
  opacity: 0.35,
  color: "#000000",
  lightSoftness: 0.18,
  objects: true,
  walls: true,
  portals: true,
  paths: true,
  patterns: true,
  roofs: true,
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
  /** Keyboard/mouse shortcuts: a preset, plus the user's changes per action. */
  shortcutPreset: PresetId
  shortcutOverrides: Record<string, string[]>
  setShortcutBindings: (actionId: string, bindings: string[]) => void
  setShortcutPreset: (preset: PresetId) => void
  /** Back to the preset's bindings (drops every change). */
  resetShortcuts: () => void
  /** Map post-processing (Settings › Post-processing). */
  postProcess: PostProcess
  /** New Map's "Disable building wear": new maps start without wear (remembered). */
  disableBuildingWear: boolean
  setDisableBuildingWear: (disable: boolean) => void
  /**
   * Pinch/pan/wheel-zoom move a snapshot of the map instead of redrawing it
   * every frame (viewSnapshot.ts). Smooth on phones, but the map looks blurry
   * until the gesture ends, so it's on by default only on mobile.
   */
  snapshotViewGestures: boolean
  /** Thumbnail columns of the docked Library (its width, dragged by its left edge). */
  libraryColumns: number
  setLibraryColumns: (columns: number) => void
  setSnapshotViewGestures: (on: boolean) => void
  setPostProcess: (patch: Partial<PostProcess>) => void
  resetPostProcess: () => void
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
      shortcutPreset: "classic",
      shortcutOverrides: {},
      setShortcutBindings: (actionId, bindings) =>
        set((s) => ({ shortcutOverrides: { ...s.shortcutOverrides, [actionId]: bindings } })),
      setShortcutPreset: (shortcutPreset) => set({ shortcutPreset, shortcutOverrides: {} }),
      resetShortcuts: () => set({ shortcutOverrides: {} }),
      postProcess: DEFAULT_POST_PROCESS,
      disableBuildingWear: false,
      setDisableBuildingWear: (disableBuildingWear) => set({ disableBuildingWear }),
      snapshotViewGestures: isMobilePlatform(),
      setSnapshotViewGestures: (snapshotViewGestures) => set({ snapshotViewGestures }),
      libraryColumns: 4,
      setLibraryColumns: (libraryColumns) => set({ libraryColumns }),
      setPostProcess: (patch) => set((s) => ({ postProcess: { ...s.postProcess, ...patch } })),
      resetPostProcess: () => set({ postProcess: DEFAULT_POST_PROCESS }),
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
    {
      name: "open20-battle-maps.settings",
      version: 1,
      // Settings saved before a shadow option existed get its default.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState>
        return {
          ...current,
          ...saved,
          shadowStyle: { ...DEFAULT_SHADOW_STYLE, ...saved.shadowStyle },
          postProcess: { ...DEFAULT_POST_PROCESS, ...saved.postProcess },
          // A preset that was renamed (or removed) falls back to the default.
          shortcutPreset: knownPreset(saved.shortcutPreset),
        }
      },
    },
  ),
)
