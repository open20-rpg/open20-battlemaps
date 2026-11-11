import { invoke } from "@tauri-apps/api/core"

/** Write a `.otbm` map file (plain JSON text). */
export function saveMapFile(path: string, contents: string): Promise<void> {
  return invoke("save_map", { path, contents })
}

/** Read a `.otbm` map file's raw JSON text. */
export function loadMapFile(path: string): Promise<string> {
  return invoke("load_map", { path })
}

/**
 * Streaming PNG export: open `path` for a `width` × `height` image, append
 * bands of RGBA rows (sent as the raw IPC body, no base64/JSON detour), then
 * finish — or cancel, which drops the export. The backend encodes on a
 * worker thread as rows arrive.
 */
export function exportBegin(path: string, width: number, height: number): Promise<void> {
  return invoke("export_begin", { path, width, height })
}

export function exportRows(rows: Uint8Array): Promise<void> {
  return invoke("export_rows", rows)
}

export function exportEnd(cancel = false): Promise<void> {
  return invoke("export_end", { cancel })
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
