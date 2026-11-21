import i18n from "../../i18n"
import { withLoading } from "../../stores/loadingStore"
import { useMapFileStore } from "../../stores/mapFileStore"
import { useMapStore } from "../../stores/mapStore"
import type { MapDocument } from "../map/model/types"
import { backupCurrentMap } from "../map/io"
import { listBackups, startBackupSession, type BackupMap } from "./api"

/** How often the open map is backed up while it has unsaved changes. */
export const AUTOSAVE_MS = 2 * 60_000
/** How often to check whether a backup is due. */
const CHECK_MS = 20_000

/** The document last backed up (the same object while nothing changed). */
let lastMap: MapDocument | null = null
let lastAt = 0
let running = false

/**
 * Back up the open map if it changed since its last backup and has
 * unsaved changes: at most every {@link AUTOSAVE_MS}, unless `now` (the
 * app is going to the background, where a phone may close it).
 */
async function backupIfDue(now: boolean): Promise<void> {
  const map = useMapStore.getState().map
  const { dirty, mapId } = useMapFileStore.getState()
  if (running || !map || !mapId || !dirty || map === lastMap) return
  if (!now && Date.now() - lastAt < AUTOSAVE_MS) return
  running = true
  try {
    await withLoading(i18n.t("loading.backingUp"), () => backupCurrentMap(true))
    lastMap = map
    lastAt = Date.now()
  } catch {
    // Disk full, or no app data folder (plain browser): try again next time.
  } finally {
    running = false
  }
}

/** Start backing up the open map in the background. Returns the stop function. */
export function startAutosave(): () => void {
  const timer = window.setInterval(() => void backupIfDue(false), CHECK_MS)
  const onHidden = () => {
    if (document.visibilityState === "hidden") void backupIfDue(true)
  }
  document.addEventListener("visibilitychange", onHidden)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener("visibilitychange", onHidden)
  }
}

let recovery: Promise<BackupMap | null> | null = null

/**
 * The map to offer recovering, once per launch: when the app didn't close
 * normally last time and a map was backed up then with unsaved changes
 * (its newest backup), that map's backups. Null otherwise.
 */
export function recoverableMap(): Promise<BackupMap | null> {
  recovery ??= (async () => {
    const previousStart = await startBackupSession()
    if (previousStart === null) return null
    const maps = await listBackups()
    return maps.find((m) => m.backups[0].unsaved && m.backups[0].createdAt >= previousStart) ?? null
  })().catch(() => null)
  return recovery
}
