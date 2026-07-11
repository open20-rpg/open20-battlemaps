import { create } from "zustand"
import { persist } from "zustand/middleware"
import { type MapTemplate } from "../lib/templates"

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
  setPanelAlpha: (alpha: number) => void
  addColorPreset: (color: string) => void
  addTemplate: (tpl: MapTemplate) => void
  removeTemplate: (id: string) => void
}

/** Pre-store keys, imported once into the versioned store then left behind. */
const LEGACY_KEYS = {
  panelAlpha: "opendraft.panel-alpha",
  colorPresets: "opendraft.colorPresets",
  userTemplates: "opendraft.userTemplates",
} as const

function readLegacy(): Partial<Pick<SettingsState, "panelAlpha" | "colorPresets" | "userTemplates">> {
  const out: ReturnType<typeof readLegacy> = {}
  try {
    const alpha = Number(localStorage.getItem(LEGACY_KEYS.panelAlpha))
    if (Number.isFinite(alpha) && alpha > 0) out.panelAlpha = alpha
    const presets = JSON.parse(localStorage.getItem(LEGACY_KEYS.colorPresets) ?? "null")
    if (Array.isArray(presets)) out.colorPresets = presets.filter((c) => typeof c === "string")
    const templates = JSON.parse(localStorage.getItem(LEGACY_KEYS.userTemplates) ?? "null")
    if (Array.isArray(templates)) out.userTemplates = templates
  } catch {
    // Corrupt legacy data: start fresh.
  }
  return out
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      panelAlpha: 0.5,
      colorPresets: [],
      userTemplates: [],
      ...readLegacy(),
      setPanelAlpha: (panelAlpha) => set({ panelAlpha }),
      addColorPreset: (color) =>
        set((s) => (s.colorPresets.includes(color) ? s : { colorPresets: [...s.colorPresets, color] })),
      addTemplate: (tpl) => set((s) => ({ userTemplates: [...s.userTemplates, tpl] })),
      removeTemplate: (id) =>
        set((s) => ({ userTemplates: s.userTemplates.filter((t) => t.id !== id) })),
    }),
    { name: "opendraft.settings", version: 1 },
  ),
)
