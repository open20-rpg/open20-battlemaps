import { invoke } from "@tauri-apps/api/core"

/** What the backups list shows of a backup (`backups.rs`). */
export interface BackupInfo {
  /** The map's name when it was backed up. */
  name: string
  /** The file the map came from or was saved to, if any. */
  sourcePath: string | null
  /** It had changes not saved to that file. */
  unsaved: boolean
  /** A small picture of the map (`data:` URL). */
  thumbnail: string | null
}

export interface BackupEntry extends BackupInfo {
  id: string
  /** When it was taken (ms since the epoch). */
  createdAt: number
  bytes: number
}

export interface BackupMap {
  mapId: string
  /** Newest first. */
  backups: BackupEntry[]
}

/** Store a backup of map `mapId` (the backend thins the older ones). */
export function writeBackup(mapId: string, contents: string, info: BackupInfo): Promise<number> {
  return invoke("backup_write", { mapId, contents, info })
}

/** Every map's backups, the most recently backed-up map first. */
export function listBackups(): Promise<BackupMap[]> {
  return invoke("backup_list")
}

/** A backup's `.otbm` text. */
export function readBackup(mapId: string, id: string): Promise<string> {
  return invoke("backup_read", { mapId, id })
}

/** Delete one backup, or all of a map's when `id` is left out. */
export function deleteBackups(mapId: string, id?: string): Promise<void> {
  return invoke("backup_delete", { mapId, id: id ?? null })
}

/**
 * Mark this session as running. Returns when the previous one started if
 * it didn't end normally (the app was closed unexpectedly), else null.
 */
export function startBackupSession(): Promise<number | null> {
  return invoke("backup_session_start")
}
