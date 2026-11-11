import { invoke } from "@tauri-apps/api/core"

/** Write a `.opdr` map file (plain JSON text). */
export function saveMapFile(path: string, contents: string): Promise<void> {
  return invoke("save_map", { path, contents })
}

/** Read a `.opdr` map file's raw JSON text. */
export function loadMapFile(path: string): Promise<string> {
  return invoke("load_map", { path })
}

/** Write binary data (base64, optionally as a data URL) to `path` (PNG export). */
export function saveBinaryFile(path: string, data: string): Promise<void> {
  return invoke("save_binary", { path, data })
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
