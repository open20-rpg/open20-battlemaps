import { useCallback } from "react"
import { DEFAULT_TEMPLATES, type MapTemplate } from "../../lib/templates"
import { useSettingsStore } from "../../stores/settingsStore"

let seq = 0

/**
 * Manages the map-template list: the built-in defaults plus user templates
 * persisted in the settings store. User templates can be added and removed;
 * built-ins cannot.
 */
export function useTemplates() {
  const user = useSettingsStore((s) => s.userTemplates)
  const add = useSettingsStore((s) => s.addTemplate)
  const removeTemplate = useSettingsStore((s) => s.removeTemplate)

  const templates: MapTemplate[] = [...DEFAULT_TEMPLATES, ...user]

  const addTemplate = useCallback(
    (name: string, width: number, height: number) => {
      const tpl: MapTemplate = {
        id: `u_${Date.now()}_${++seq}`,
        name,
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      }
      add(tpl)
      return tpl
    },
    [add],
  )

  return { templates, addTemplate, removeTemplate }
}
