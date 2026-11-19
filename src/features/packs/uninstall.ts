import { confirm } from "@tauri-apps/plugin-dialog"
import i18n from "../../i18n"
import { withLoading } from "../../stores/loadingStore"
import { usePacksStore } from "../../stores/packsStore"
import { clearPackReferences, isPackUsed } from "../map/packUsage"
import { uninstallPack } from "./api"

/**
 * Uninstall packs after asking (and warning when the open map uses one: its
 * configs that reference it are reset, outside undo/redo). Shared by the
 * Assets manager and Settings › Storage. Resolves whether they were removed.
 */
export async function uninstallPacks(ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return false
  const t = i18n.t.bind(i18n)
  const usedIds = ids.filter((id) => isPackUsed(id))
  if (usedIds.length > 0) {
    const ok = await confirm(t("assets.deleteUsedConfirm", { count: usedIds.length }), {
      title: t("assets.deleteUsedTitle"),
      kind: "warning",
    })
    if (!ok) return false
  }
  const ok = await confirm(t("assets.deleteConfirm", { count: ids.length }), {
    title: t("assets.deleteTitle"),
    kind: "warning",
  })
  if (!ok) return false
  await withLoading(t("loading.deletingAssets"), async () => {
    for (const id of usedIds) clearPackReferences(id)
    // Each uninstall touches its own pack directory, so they are
    // independent and safe to run in parallel.
    await Promise.all(ids.map((id) => uninstallPack(id)))
    usePacksStore.getState().removePacks([...ids])
  })
  return true
}
