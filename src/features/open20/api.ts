import { invoke } from "@tauri-apps/api/core"

/** Pages of open20.app the app links to (one per product it checks for updates). */
export type Open20Page = "battle-maps" | "essentials"

/** The latest published version of a product, or null when it can't be known now. */
export function latestVersion(product: Open20Page): Promise<string | null> {
  return invoke("latest_version", { product })
}

/** Open a page of open20.app in the system browser. */
export function openOpen20Page(page: Open20Page): Promise<void> {
  return invoke("open_open20_page", { page })
}
