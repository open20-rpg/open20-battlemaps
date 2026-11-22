import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { type FolderEntry } from "@open20/battlemaps-sdk/protocol"
import { base64ToBytes, bytesToBase64 } from "../../lib/base64"
import { type RegistryEntry } from "./services"

/** The extensions' native side (src-tauri/src/extensions.rs). */

export function readRegistry(): Promise<RegistryEntry[]> {
  return invoke("extensions_registry")
}

export function saveRegistry(entries: RegistryEntry[]): Promise<void> {
  return invoke("extensions_save_registry", { entries })
}

export function installExtensionFiles(id: string, files: Map<string, Uint8Array>): Promise<void> {
  return invoke("extension_install", {
    id,
    files: [...files].map(([path, bytes]) => ({ path, data: bytesToBase64(bytes) })),
  })
}

export function uninstallExtension(id: string): Promise<void> {
  return invoke("extension_uninstall", { id })
}

export async function readExtensionFile(id: string, path: string): Promise<Uint8Array> {
  return base64ToBytes(await invoke<string>("extension_read_file", { id, path }))
}

export async function readDevFolder(path: string): Promise<Map<string, Uint8Array>> {
  const files = await invoke<{ path: string; data: string }[]>("extension_read_dir", { path })
  return new Map(files.map((f) => [f.path, base64ToBytes(f.data)]))
}

export function storageGet(id: string, key: string): Promise<unknown> {
  return invoke("extension_storage_get", { id, key })
}

export function storageSet(id: string, key: string, value: unknown): Promise<void> {
  return invoke("extension_storage_set", { id, key, value: value ?? null })
}

export function storageDelete(id: string, key: string): Promise<void> {
  return invoke("extension_storage_delete", { id, key })
}

export function storageKeys(id: string): Promise<string[]> {
  return invoke("extension_storage_keys", { id })
}

export async function extensionFetch(req: {
  url: string
  method: string
  headers: Record<string, string>
  body?: Uint8Array
}): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }> {
  const res = await invoke<{ status: number; headers: Record<string, string>; body: string }>(
    "extension_fetch",
    {
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body ? bytesToBase64(req.body) : null,
    },
  )
  return { status: res.status, headers: res.headers, body: base64ToBytes(res.body) }
}

export function folderList(root: string, path: string): Promise<FolderEntry[]> {
  return invoke("extension_folder_list", { root, path })
}

export async function folderRead(root: string, path: string): Promise<Uint8Array> {
  return base64ToBytes(await invoke<string>("extension_folder_read", { root, path }))
}

export function folderWrite(root: string, path: string, bytes: Uint8Array): Promise<void> {
  return invoke("extension_folder_write", { root, path, data: bytesToBase64(bytes) })
}

export function openExtensionUrl(url: string): Promise<void> {
  return invoke("extension_open_url", { url })
}

/** Read a file the user picked (through the map backend's reader). */
export async function readPickedFile(path: string): Promise<Uint8Array> {
  const dir = path.replace(/[\\/][^\\/]*$/, "")
  const name = path.slice(dir.length + 1)
  return base64ToBytes(await invoke<string>("extension_folder_read", { root: dir, path: name }))
}

export async function writePickedFile(path: string, bytes: Uint8Array): Promise<void> {
  const dir = path.replace(/[\\/][^\\/]*$/, "")
  const name = path.slice(dir.length + 1)
  await invoke("extension_folder_write", { root: dir, path: name, data: bytesToBase64(bytes) })
}

export async function pickFilePaths(
  extensions: string[] | undefined,
  multiple: boolean,
): Promise<string[]> {
  const picked = await open({
    multiple,
    filters: extensions?.length ? [{ name: extensions.join(", "), extensions }] : undefined,
  })
  if (!picked) return []
  return Array.isArray(picked) ? picked : [picked]
}

export async function pickSavePath(name: string): Promise<string | null> {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : ""
  return save({ defaultPath: name, filters: ext ? [{ name: ext, extensions: [ext] }] : undefined })
}

export async function pickFolderPath(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false })
  return typeof picked === "string" ? picked : null
}

/** Put bytes an extension handed over in a temporary file (for the pack importer). */
export function writeTempFile(id: string, name: string, bytes: Uint8Array): Promise<string> {
  return invoke("extension_temp_write", { id, name, data: bytesToBase64(bytes) })
}
