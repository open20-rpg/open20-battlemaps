import { confirm } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { toaster } from "../../ui/chakra/toaster-instance"
import { useMapDirty } from "../../stores/mapFileStore"
import { openMapFlow, saveMap, saveMapAs } from "./io"

/**
 * Save/Open handlers for the menu bar: wraps `features/map/io` with user
 * feedback (toasts) and an unsaved-changes confirmation before any action
 * that would discard the current map (New/Open/Close). Only the map document
 * counts as "unsaved" — tool params and view toggles don't gate the guard.
 */
export function useMapFile() {
  const { t } = useTranslation()
  const dirty = useMapDirty()

  const confirmDiscard = async (): Promise<boolean> => {
    if (!dirty) return true
    return confirm(t("mapFile.discardBody"), {
      title: t("mapFile.discardTitle"),
      kind: "warning",
      okLabel: t("mapFile.discardConfirm"),
      cancelLabel: t("mapFile.discardCancel"),
    })
  }

  /** Wrap an action that discards the current map behind the dirty-check confirm. */
  const guarded = (fn: () => void | Promise<void>) => async (): Promise<void> => {
    if (await confirmDiscard()) await fn()
  }

  const handleSave = async (): Promise<void> => {
    try {
      if (await saveMap()) toaster.create({ title: t("toast.mapSaved"), type: "success" })
    } catch (err) {
      toaster.create({ title: t("toast.mapSaveError", { error: String(err) }), type: "error" })
    }
  }

  const handleSaveAs = async (): Promise<void> => {
    try {
      if (await saveMapAs()) toaster.create({ title: t("toast.mapSaved"), type: "success" })
    } catch (err) {
      toaster.create({ title: t("toast.mapSaveError", { error: String(err) }), type: "error" })
    }
  }

  const handleOpen = guarded(async () => {
    try {
      await openMapFlow()
    } catch (err) {
      toaster.create({ title: t("toast.mapOpenError", { error: String(err) }), type: "error" })
    }
  })

  return { handleSave, handleSaveAs, handleOpen, guarded }
}
