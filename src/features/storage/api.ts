import { invoke } from "@tauri-apps/api/core"

/** One installed pack's disk use (by id; its name comes from the packs list). */
export interface PackUsage {
  id: string
  /** Its files, thumbnails apart. */
  bytes: number
  /** Its Library thumbnails. */
  thumbnailBytes: number
}

/** What the app keeps in its data folder, by kind (Settings › Storage). */
export interface StorageUsage {
  packs: PackUsage[]
  fontsBytes: number
  fontsCount: number
  /** Everything else (the pack registry…). */
  otherBytes: number
  totalBytes: number
}

/** Data the app can bring back by itself, so it can be cleared. */
export type ClearableStorage = "thumbnails" | "fonts"

export function storageUsage(): Promise<StorageUsage> {
  return invoke("storage_usage")
}

export function clearStorage(kind: ClearableStorage): Promise<void> {
  return invoke("clear_storage", { kind })
}
