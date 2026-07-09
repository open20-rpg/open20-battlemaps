/** Default custom color applied to colorable assets until the user changes it. */
export const DEFAULT_CUSTOM_COLOR = "#6b3834"

/**
 * Built-in color presets shown in the Custom Color dropdown. Placeholder set —
 * to be replaced with the final palette.
 */
export const BUILTIN_COLOR_PRESETS: string[] = [
  "#6b3834",
  "#8a4b3b",
  "#b06a4a",
  "#caa472",
  "#7a8b5a",
  "#4f7a6b",
  "#4a6a8c",
  "#6b4a7a",
  "#2b2b2f",
  "#c9c9cf",
]

const LS_KEY = "opendraft.colorPresets"

/** User-added color presets, persisted in localStorage. */
export function loadUserPresets(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]")
    return Array.isArray(arr) ? arr.filter((c) => typeof c === "string") : []
  } catch {
    return []
  }
}

export function saveUserPresets(presets: string[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(presets))
}
