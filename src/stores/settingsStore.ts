import { create } from "zustand"
import { persist } from "zustand/middleware"
import { loadUserPresets } from "../lib/colors"
import { loadUserTemplates, type MapTemplate } from "../lib/templates"

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

/**
 * Seed defaults from the pre-store localStorage keys (panel-alpha, color
 * presets, user templates) so existing users keep their data. The persisted
 * store value, when present, overrides these on rehydration.
 */
function readLegacy(): Partial<
  Pick<SettingsState, "panelAlpha" | "colorPresets" | "userTemplates">
> {
  const out: ReturnType<typeof readLegacy> = {}
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
