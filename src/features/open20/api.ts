import { invoke } from "@tauri-apps/api/core"

/** Products whose new versions the app checks (each has its page on open20.app). */
export type Open20Product = "battle-maps" | "essentials"

/** Pages the app links to: the products' pages, and Open20's community and support. */
export type Open20Page = Open20Product | "discord" | "patreon" | "kofi"

/** The latest published version of a product, or null when it can't be known now. */
export function latestVersion(product: Open20Product): Promise<string | null> {
  return invoke("latest_version", { product })
}

/** Open one of those pages in the system browser. */
export function openOpen20Page(page: Open20Page): Promise<void> {
  return invoke("open_open20_page", { page })
}
