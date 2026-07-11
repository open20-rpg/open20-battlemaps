export interface MapTemplate {
  id: string
  name: string
  /** Width in tiles. */
  width: number
  /** Height in tiles. */
  height: number
  /** Built-in templates cannot be deleted. */
  builtin?: boolean
}

/** Default, non-deletable templates. */
export const DEFAULT_TEMPLATES: MapTemplate[] = [
  { id: "tv40", name: '40" TV', width: 35, height: 20, builtin: true },
  { id: "tv55", name: '55" TV', width: 48, height: 27, builtin: true },
  { id: "a4", name: "A4 Paper", width: 11, height: 8, builtin: true },
  { id: "a3", name: "A3 Paper", width: 16, height: 11, builtin: true },
]

const STORAGE_KEY = "opendraft.userTemplates"

/**
 * User templates from the pre-settings-store localStorage key (tolerant of bad
 * data). Only used to seed the settings store for existing users; new writes
 * go through the store.
 */
export function loadUserTemplates(): MapTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (t) =>
          t && typeof t.name === "string" && Number.isFinite(t.width) && Number.isFinite(t.height),
      )
      .map((t) => ({
        id: String(t.id ?? `u_${t.name}`),
        name: String(t.name),
        width: Math.max(1, Math.round(t.width)),
        height: Math.max(1, Math.round(t.height)),
      }))
  } catch {
    return []
  }
}
