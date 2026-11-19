import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { open, save } from "@tauri-apps/plugin-dialog"
import { type Adjust } from "./userAssets"

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
  /** Created in the app: only these can be edited and exported. */
  editable: boolean
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

/** Enable or disable several packs in one registry write (concurrent toggles would race). */
export function setPacksEnabled(ids: string[], enabled: boolean): Promise<void> {
  return invoke("set_packs_enabled", { ids, enabled })
}

export function loadPackThumbnail(id: string): Promise<LoadedImage | null> {
  return invoke("load_pack_thumbnail", { id })
}

/** Subscribe to install progress events. Returns an unlisten function. */
export function onInstallProgress(cb: (p: InstallProgress) => void): Promise<UnlistenFn> {
  return listen<InstallProgress>("pack-install-progress", (e) => cb(e.payload))
}

export function toDataUrl(img: LoadedImage): string {
  return `data:${img.mime};base64,${img.data}`
}

// -- user packs (created in the app) --------------------------------------------

export interface PackMeta {
  name: string
  author: string
  version: string
  keywords: string[]
}

/** Image types the import accepts. */
export const IMPORT_EXTENSIONS = ["png", "webp", "jpg", "jpeg"]

/** Open a native file picker for one or more images. */
export async function pickImageFiles(multiple = true): Promise<string[]> {
  const selected = await open({
    multiple,
    filters: [{ name: "Images", extensions: IMPORT_EXTENSIONS }],
  })
  if (!selected) return []
  return Array.isArray(selected) ? selected : [selected]
}

/** Ask where to write an exported pack. */
export async function pickPackExportPath(name: string): Promise<string | null> {
  const safe = name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "pack"
  return save({
    defaultPath: `${safe}.dungeondraft_pack`,
    filters: [{ name: "Dungeondraft Pack", extensions: ["dungeondraft_pack"] }],
  })
}

export function createUserPack(meta: PackMeta): Promise<InstalledPack> {
  return invoke("create_user_pack", { meta })
}

export function updateUserPack(id: string, meta: PackMeta): Promise<InstalledPack> {
  return invoke("update_user_pack", { id, meta })
}

/** A picked image, decoded once: its size, content bounds and a small preview file. */
export interface ImportPreview {
  /** Absolute path of the preview PNG (see `thumbUrl`). */
  path: string
  width: number
  height: number
  /** Opaque content (x, y, w, h) — null when fully transparent. */
  bounds: [number, number, number, number] | null
  opaque: boolean
  sizeBytes: number
}

export function importPreview(source: string): Promise<ImportPreview> {
  return invoke("import_preview", { source })
}

export function clearImportPreviews(): Promise<void> {
  return invoke("clear_import_previews")
}

/** One item to import (mirrors `ImportItem` in userpack.rs). */
export interface ImportItem {
  source: string
  category: string
  name: string
  folder: string
  parts: Record<string, string>
  adjust: Adjust
  colorable: boolean
  tags: string[]
  color: string | null
}

export type ImportQuality = "lossless" | "balanced"

export interface ImportReport {
  imported: string[]
  failed: { name: string; error: string }[]
  pack: InstalledPack
}

export function importUserAssets(
  packId: string,
  items: ImportItem[],
  quality: ImportQuality,
): Promise<ImportReport> {
  return invoke("import_user_assets", { packId, items, quality })
}

export interface ImportProgress {
  name: string
  index: number
  total: number
}

export function onImportProgress(cb: (p: ImportProgress) => void): Promise<UnlistenFn> {
  return listen<ImportProgress>("user-pack-import-progress", (e) => cb(e.payload))
}

export interface UserAssetInfo {
  id: string
  category: string
  name: string
  folder: string
  /** Absolute path of the main texture. */
  path: string
  width: number
  height: number
  sizeBytes: number
  parts: string[]
  colorable: boolean
  tags: string[]
  color: string | null
}

export function userAssetInfo(id: string): Promise<UserAssetInfo> {
  return invoke("user_asset_info", { id })
}

/** What an edit changes; absent fields stay (`color: null` clears it). */
export interface AssetEdit {
  name?: string
  folder?: string
  tags?: string[]
  colorable?: boolean
  color?: string | null
  adjust?: Adjust
}

export interface EditResult {
  id: string
  /** Files rewritten in place: their cached images must reload. */
  changedFiles: string[]
  pack: InstalledPack
}

export function editUserAsset(id: string, edit: AssetEdit): Promise<EditResult> {
  return invoke("edit_user_asset", { id, edit })
}

export function deleteUserAssets(ids: string[]): Promise<InstalledPack | null> {
  return invoke("delete_user_assets", { ids })
}

export interface UserPackInfo {
  folders: string[]
  tags: string[]
  counts: Record<string, number>
}

export function userPackInfo(id: string): Promise<UserPackInfo> {
  return invoke("user_pack_info", { id })
}

export function exportUserPack(id: string, dest: string): Promise<void> {
  return invoke("export_user_pack", { id, dest })
}

export function onExportProgress(
  cb: (p: { index: number; total: number }) => void,
): Promise<UnlistenFn> {
  return listen<{ index: number; total: number }>("user-pack-export-progress", (e) => cb(e.payload))
}
