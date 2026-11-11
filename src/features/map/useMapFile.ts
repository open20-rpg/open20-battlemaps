import { message } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { toaster } from "../../ui/chakra/toaster-instance"
import { useMapDirty } from "../../stores/mapFileStore"
import { openMapFlow, saveMap, saveMapAs } from "./io"

/**
 * Save/Open handlers for the menu bar: wraps `features/map/io` with user
 * feedback (toasts) and, before any action that would discard the current
 * map (New/Open/Close, quitting the app), a Save / Don't save / Cancel
 * prompt. Only the map document counts as "unsaved" — tool params and view
 * toggles don't gate the guard.
 */
export function useMapFile() {
  const { t } = useTranslation()
  const dirty = useMapDirty()

  /** Save, with feedback; true once it's saved. */
  const save = async (): Promise<boolean> => {
    try {
      const saved = await saveMap()
      if (saved) toaster.create({ title: t("toast.mapSaved"), type: "success" })
      return saved
    } catch (err) {
      toaster.create({ title: t("toast.mapSaveError", { error: String(err) }), type: "error" })
      return false
    }
  }

  /**
   * Settle unsaved changes before the map goes away: true to go on (it was
   * saved, or the user chose not to), false to stay (cancelled, or the save
   * didn't happen).
   */
  const settleUnsaved = async (): Promise<boolean> => {
    if (!dirty) return true
    const labels = {
      yes: t("mapFile.save"),
      no: t("mapFile.dontSave"),
      cancel: t("mapFile.cancel"),
    }
    const answer = await message(t("mapFile.unsavedBody"), {
      title: t("mapFile.unsavedTitle"),
      kind: "warning",
      buttons: labels,
    })
    // Custom buttons answer with their label (older versions: Yes/No/Cancel).
    if (answer === labels.yes || answer === "Yes") return save()
    return answer === labels.no || answer === "No"
  }

  /** Wrap an action that discards the current map behind the unsaved-changes prompt. */
  const guarded = (fn: () => void | Promise<void>) => async (): Promise<void> => {
    if (await settleUnsaved()) await fn()
  }

  const handleSave = async (): Promise<void> => {
    await save()
  }

  const handleSaveAs = async (): Promise<void> => {
    try {
      if (await saveMapAs()) toaster.create({ title: t("toast.mapSaved"), type: "success" })
    } catch (err) {
      toaster.create({ title: t("toast.mapSaveError", { error: String(err) }), type: "error" })
    }
  }

  const openMap = async (path?: string): Promise<void> => {
    try {
      const { opened, missingPacks, imported } = await openMapFlow(path)
      if (opened && imported) {
        const notes = Object.entries(imported).map(([key, count]) => t(`import.${key}`, { count }))
        toaster.create({
          title: t("toast.importedDungeondraft"),
          description: notes.length > 0 ? notes.join(" · ") : undefined,
          type: notes.length > 0 ? "warning" : "success",
          duration: notes.length > 0 ? 12000 : undefined,
        })
      }
      if (opened && missingPacks.length > 0) {
        toaster.create({
          title: t("toast.missingPacks", { count: missingPacks.length }),
          type: "warning",
        })
      }
    } catch (err) {
      toaster.create({ title: t("toast.mapOpenError", { error: String(err) }), type: "error" })
    }
  }

  const handleOpen = guarded(() => openMap())
  /** Open a specific file (Recent maps), behind the same unsaved-changes guard. */
  const handleOpenPath = (path: string) => guarded(() => openMap(path))()

  return { handleSave, handleSaveAs, handleOpen, handleOpenPath, guarded, settleUnsaved }
}
