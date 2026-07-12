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

/**
 * User presets from the pre-settings-store localStorage key. Only used to seed
 * the settings store for existing users; new writes go through the store.
 */
export function loadUserPresets(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem("opendraft.colorPresets") ?? "[]")
    return Array.isArray(arr) ? arr.filter((c) => typeof c === "string") : []
  } catch {
    return []
  }
}

/**
 * Parse a `#RRGGBB`/`#RRGGBBAA` hex color into the `{ color, alpha }` shape
 * PixiJS fill/stroke styles expect (a 24-bit color plus a separate 0-1 alpha).
 */
export function hexToPixiColor(hex: string): { color: number; alpha: number } {
  const clean = hex.replace("#", "")
  const color = parseInt(clean.slice(0, 6), 16)
  const alpha = clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1
  return { color, alpha }
}
