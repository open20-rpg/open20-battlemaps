import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { open } from "@tauri-apps/plugin-dialog"

export interface InstalledPack {
  id: string
  name: string
  version?: string | null
  author?: string | null
  keywords: string[]
  enabled: boolean
  path: string
  fileCount: number
  sizeBytes: number
}

export interface AssetInfo {
  relPath: string
  category: string
  sizeBytes: number
}

export interface LoadedImage {
  mime: string
  /** base64 without data-url prefix */
  data: string
}

export interface InstallProgress {
  pack: string
  fileName: string
  index: number
  total: number
  percent: number
}

/** Open a native file picker for one or more .dungeondraft_pack files. */
export async function pickPackFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    filters: [{ name: "Dungeondraft Pack", extensions: ["dungeondraft_pack"] }],
  })
  if (!selected) return []
  return Array.isArray(selected) ? selected : [selected]
}

export function installPacks(paths: string[]): Promise<InstalledPack[]> {
  return invoke("install_packs", { paths })
}

export function listInstalled(): Promise<InstalledPack[]> {
  return invoke("list_installed")
}

export function uninstallPack(id: string): Promise<void> {
  return invoke("uninstall_pack", { id })
}

/** Open the folder where packs are unpacked in the system file manager. */
export function openPacksDir(): Promise<void> {
  return invoke("open_packs_dir")
}

export function setPackEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke("set_pack_enabled", { id, enabled })
}

export function listPackContents(id: string): Promise<AssetInfo[]> {
  return invoke("list_pack_contents", { id })
}

export function loadAsset(id: string, relPath: string): Promise<LoadedImage> {
  return invoke("load_asset", { id, relPath })
}

export function loadPackThumbnail(id: string): Promise<LoadedImage | null> {
  return invoke("load_pack_thumbnail", { id })
}

/** Subscribe to install progress events. Returns an unlisten function. */
export function onInstallProgress(
  cb: (p: InstallProgress) => void,
): Promise<UnlistenFn> {
  return listen<InstallProgress>("pack-install-progress", (e) => cb(e.payload))
}

export function toDataUrl(img: LoadedImage): string {
  return `data:${img.mime};base64,${img.data}`
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
