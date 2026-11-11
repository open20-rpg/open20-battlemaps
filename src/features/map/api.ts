import { invoke } from "@tauri-apps/api/core"

/** Write a `.opdr` map file (plain JSON text). */
export function saveMapFile(path: string, contents: string): Promise<void> {
  return invoke("save_map", { path, contents })
}

/** Read a `.opdr` map file's raw JSON text. */
export function loadMapFile(path: string): Promise<string> {
  return invoke("load_map", { path })
}

/**
 * Write binary data to `path` (PNG export). The bytes travel as the raw IPC
 * body — no base64/JSON round trip for multi-megabyte files — with the path
 * in a header (percent-encoded: header values must be ASCII).
 */
export function saveBytes(path: string, bytes: Uint8Array): Promise<void> {
  return invoke("save_bytes", bytes, { headers: { "x-path": encodeURIComponent(path) } })
}

/** Read an arbitrary image from disk as a data URL (Reference Image tool). */
export async function readImageFile(path: string): Promise<string> {
  const res = await invoke<{ dataUrl: string }>("read_image_file", { path })
  return res.dataUrl
}

export interface ResolvedAsset {
  id: string
  /** Absolute texture path, or null when its pack/file isn't installed. */
  path: string | null
  colorable: boolean
}

/** Resolve placed asset ids (`{packId}|{relPath}`) to their texture files. */
export function resolveAssets(ids: string[]): Promise<ResolvedAsset[]> {
  return invoke("resolve_assets", { ids })
}
