import { useCallback, useState } from "react"
import {
  DEFAULT_TEMPLATES,
  loadUserTemplates,
  saveUserTemplates,
  type MapTemplate,
} from "../lib/templates"

let seq = 0

/**
 * Manages the map-template list: the built-in defaults plus user templates
 * persisted in localStorage. User templates can be added and removed; built-ins
 * cannot.
 */
export function useTemplates() {
  const [user, setUser] = useState<MapTemplate[]>(loadUserTemplates)

  const templates: MapTemplate[] = [...DEFAULT_TEMPLATES, ...user]

  const addTemplate = useCallback((name: string, width: number, height: number) => {
    const tpl: MapTemplate = {
      id: `u_${Date.now()}_${++seq}`,
      name,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    }
    setUser((prev) => {
      const next = [...prev, tpl]
      saveUserTemplates(next)
      return next
    })
    return tpl
  }, [])

  const removeTemplate = useCallback((id: string) => {
    setUser((prev) => {
      const next = prev.filter((t) => t.id !== id)
      saveUserTemplates(next)
      return next
    })
  }, [])

  return { templates, addTemplate, removeTemplate }
}
