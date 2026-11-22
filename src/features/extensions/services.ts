import {
  type AssetInfo,
  type AssetSearch,
  type FileData,
  type Permission,
  type PackInfo,
} from "@open20/battlemaps-sdk"
import { type FolderEntry, type ResultOf } from "@open20/battlemaps-sdk/protocol"

/** What the registry on disk keeps per extension. */
export interface RegistryEntry {
  id: string
  enabled: boolean
  granted: Permission[]
  settings: Record<string, unknown>
  /** Development mode: loaded from this folder instead of the installed copy. */
  devPath?: string
}

export interface FetchRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: Uint8Array
}

export interface SocketHandle {
  send(data: string): void
  close(): void
}

/**
 * Everything the host needs from the platform (Tauri, the file system, the
 * network). The app uses tauriServices.ts; tests use fakes. Keeping it an
 * interface is also what keeps `invoke()` inside api.ts.
 */
export interface HostServices {
  // installed extensions
  listRegistry(): Promise<RegistryEntry[]>
  saveRegistry(entries: RegistryEntry[]): Promise<void>
  installFiles(id: string, files: Map<string, Uint8Array>): Promise<void>
  uninstall(id: string): Promise<void>
  readFile(id: string, path: string): Promise<Uint8Array>
  readDevFolder(path: string): Promise<Map<string, Uint8Array>>
  pickPackage(): Promise<FileData | null>
  pickDevFolder(): Promise<string | null>
  // per-extension storage
  storageGet(id: string, key: string): Promise<unknown>
  storageSet(id: string, key: string, value: unknown): Promise<void>
  storageDelete(id: string, key: string): Promise<void>
  storageKeys(id: string): Promise<string[]>
  // network (the host checks the permission first)
  fetch(req: FetchRequest): Promise<ResultOf<"net.fetch">>
  openSocket(url: string, onMessage: (d: string) => void, onClose: () => void): SocketHandle
  // files and folders the user picks
  pickFiles(extensions: string[] | undefined, multiple: boolean): Promise<FileData[]>
  saveFile(file: FileData): Promise<boolean>
  pickFolder(): Promise<string | null>
  folderList(root: string, path: string): Promise<FolderEntry[]>
  folderRead(root: string, path: string): Promise<Uint8Array>
  folderWrite(root: string, path: string, bytes: Uint8Array): Promise<void>
  // system
  clipboardWriteText(text: string): Promise<void>
  clipboardReadText(): Promise<string>
  clipboardWriteImage(image: FileData): Promise<void>
  openUrl(url: string): Promise<void>
  // library and packs
  libraryPacks(): Promise<PackInfo[]>
  librarySearch(q: AssetSearch): Promise<AssetInfo[]>
  libraryAsset(id: string): Promise<AssetInfo | null>
  libraryImage(id: string, size?: number): Promise<FileData | null>
  createPack(name: string, author: string): Promise<string>
  importImages(pack: string, files: FileData[], category: string): Promise<string[]>
  setAssetTags(asset: string, tags: string[]): Promise<void>
  setAssetMetadata(asset: string, data: Record<string, unknown>): Promise<void>
  loadFont(family: string): Promise<boolean>
}

/** A file's extension, lowercase, without the dot. */
export const fileExtension = (name: string): string => {
  const dot = name.lastIndexOf(".")
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ""
}
