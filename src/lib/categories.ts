/**
 * Asset categories shared between tool definitions, the library UI and the
 * Rust backend (which scans pack folders by these names). Keep in sync with
 * `category_folder` in src-tauri.
 */
export const ASSET_CATEGORIES = [
  "tilesets",
  "walls",
  "portals",
  "caves",
  "roofs",
  "paths",
  "objects",
] as const

export type AssetCategory = (typeof ASSET_CATEGORIES)[number]
