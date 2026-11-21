import { create } from "zustand"
import { knownPreset, type PresetId } from "../features/shortcuts/actions"
import { persist } from "zustand/middleware"
import { type MapTemplate } from "../lib/templates"
import { type MapEntity } from "../features/map/model/types"
import { isMobilePlatform } from "../lib/platform"
import {
  defaultPreset,
  PRESET_SETTINGS,
  type RenderPerformance,
  withPerformanceDefaults,
} from "../lib/renderPerformance"

/** A new install's graphics: Low on phones and tablets, Medium elsewhere. */
const DEVICE_PERFORMANCE = PRESET_SETTINGS[defaultPreset(isMobilePlatform())]

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

/** A recently opened/saved map file. */
export interface RecentMap {
  path: string
  /** Its picture as last saved or opened (JPEG `data:` URL, a few KB). */
  thumbnail?: string
  /** When it was last opened or saved (ms since the epoch). */
  usedAt?: number
}

/**
 * Recent maps as saved: plain paths before they had thumbnails. Anything
 * else is dropped.
 */
export function normalizeRecentMaps(saved: unknown): RecentMap[] {
  if (!Array.isArray(saved)) return []
  return saved.flatMap((r: unknown): RecentMap[] => {
    if (typeof r === "string") return [{ path: r }]
    if (r && typeof r === "object" && typeof (r as RecentMap).path === "string") {
      return [r as RecentMap]
    }
    return []
  })
}

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
  recentMaps: RecentMap[]
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
  /** New Map's "Disable building wear": new maps start without wear (remembered). */
  disableBuildingWear: boolean
  setDisableBuildingWear: (disable: boolean) => void
  /**
   * Pinch/pan/wheel-zoom move a snapshot of the map instead of redrawing it
   * every frame (viewSnapshot.ts). Smoother on slow devices, but the map
   * looks blurry until the gesture ends: off by default, at every quality.
   */
  snapshotViewGestures: boolean
  /** How the map is rendered, traded against speed (Settings › Performance). */
  performance: RenderPerformance
  setPerformance: (patch: Partial<RenderPerformance>) => void
  /** Replace every performance setting (a preset, or back to the defaults). */
  replacePerformance: (perf: RenderPerformance) => void
  /** Settings › Debug: show the stats panel (frames per second…) over the map. */
  statsPanel: boolean
  setStatsPanel: (on: boolean) => void
  /** Settings › Debug: show Performance's per-part measurement (ms each part of a frame costs). */
  graphicsDetail: boolean
  setGraphicsDetail: (on: boolean) => void
  /** The first-launch notice about the graphics level was answered (or dismissed). */
  graphicsIntroSeen: boolean
  setGraphicsIntroSeen: (seen: boolean) => void
  /** Thumbnail columns of the docked Library (its width, dragged by its left edge). */
  libraryColumns: number
  setLibraryColumns: (columns: number) => void
  setSnapshotViewGestures: (on: boolean) => void
  setPanelAlpha: (alpha: number) => void
  addColorPreset: (color: string) => void
  addTemplate: (tpl: MapTemplate) => void
  removeTemplate: (id: string) => void
  addPrefab: (prefab: Prefab) => void
  renamePrefab: (id: string, name: string) => void
  removePrefab: (id: string) => void
  /** Move `path` to the top of the recent list (with its new thumbnail, if any). */
  pushRecentMap: (path: string, thumbnail?: string | null) => void
  removeRecentMap: (path: string) => void
}

/**
 * Version of the saved settings. 2: graphics come in presets (Low on
 * phones and tablets, Medium elsewhere). 3: the presets were rebalanced and
 * moving a snapshot of the map is off by default. Each time, the graphics
 * settings saved before are dropped, so the device's preset applies.
 */
export const SETTINGS_VERSION = 3

/** Settings each version resets to their defaults. */
const RESET_IN: Record<number, readonly string[]> = {
  2: ["performance"],
  3: ["performance", "snapshotViewGestures"],
}

/** Bring settings saved as `version` up to date (the rest of them are kept). */
export function migrateSettings(persisted: unknown, version: number): unknown {
  if (version >= SETTINGS_VERSION || !persisted || typeof persisted !== "object") return persisted
  const reset = new Set(
    Object.entries(RESET_IN).flatMap(([v, keys]) => (Number(v) > version ? keys : [])),
  )
  return Object.fromEntries(Object.entries(persisted).filter(([key]) => !reset.has(key)))
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
      disableBuildingWear: false,
      setDisableBuildingWear: (disableBuildingWear) => set({ disableBuildingWear }),
      snapshotViewGestures: false,
      setSnapshotViewGestures: (snapshotViewGestures) => set({ snapshotViewGestures }),
      performance: DEVICE_PERFORMANCE,
      setPerformance: (patch) => set((s) => ({ performance: { ...s.performance, ...patch } })),
      replacePerformance: (performance) => set({ performance }),
      statsPanel: false,
      setStatsPanel: (statsPanel) => set({ statsPanel }),
      graphicsDetail: false,
      setGraphicsDetail: (graphicsDetail) => set({ graphicsDetail }),
      graphicsIntroSeen: false,
      setGraphicsIntroSeen: (graphicsIntroSeen) => set({ graphicsIntroSeen }),
      libraryColumns: 4,
      setLibraryColumns: (libraryColumns) => set({ libraryColumns }),
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
      pushRecentMap: (path, thumbnail) =>
        set((s) => {
          const previous = s.recentMaps.find((r) => r.path === path)
          const entry: RecentMap = {
            path,
            thumbnail: thumbnail ?? previous?.thumbnail,
            usedAt: Date.now(),
          }
          const rest = s.recentMaps.filter((r) => r.path !== path)
          return { recentMaps: [entry, ...rest].slice(0, MAX_RECENT_MAPS) }
        }),
      removeRecentMap: (path) =>
        set((s) => ({ recentMaps: s.recentMaps.filter((r) => r.path !== path) })),
    }),
    {
      name: "open20-battle-maps.settings",
      version: SETTINGS_VERSION,
      migrate: (persisted, version) => migrateSettings(persisted, version),
      // Settings saved before a shadow option existed get its default.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState>
        return {
          ...current,
          ...saved,
          shadowStyle: { ...DEFAULT_SHADOW_STYLE, ...saved.shadowStyle },
          // Saved as plain paths before recent maps had thumbnails.
          recentMaps: normalizeRecentMaps(saved.recentMaps),
          performance: withPerformanceDefaults(saved.performance, DEVICE_PERFORMANCE),
          // A preset that was renamed (or removed) falls back to the default.
          shortcutPreset: knownPreset(saved.shortcutPreset),
        }
      },
    },
  ),
)
