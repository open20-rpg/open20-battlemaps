import { convertFileSrc, invoke } from "@tauri-apps/api/core"

/** Installed OS font family names, sorted (for the Text tool's font selector). */
export function listSystemFonts(): Promise<string[]> {
  return invoke("list_system_fonts")
}

/** The cached font file `fileName`, or null when it hasn't been downloaded. */
export function cachedFont(fileName: string): Promise<string | null> {
  return invoke("cached_font", { fileName })
}

/** Download a Google font into the cache (no-op when it's there); its path. */
export function downloadFont(url: string, fileName: string): Promise<string> {
  return invoke("download_font", { url, fileName })
}

/** A cached font file as a URL the webview can load. */
export const fontFileUrl = (path: string): string => convertFileSrc(path)
