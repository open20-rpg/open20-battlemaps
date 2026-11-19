import i18n from "../../i18n"
import { withLoading } from "../../stores/loadingStore"
import { toaster } from "../../ui/chakra/toaster-instance"
import { exportUserPack, onExportProgress, pickPackExportPath, type InstalledPack } from "./api"

/**
 * Export a user pack as a `.dungeondraft_pack`: ask where, then write it
 * (streamed on a worker thread, progress in the status bar). Resolves
 * whether it was written.
 */
export async function exportPack(pack: InstalledPack): Promise<boolean> {
  const t = i18n.t.bind(i18n)
  const dest = await pickPackExportPath(pack.name)
  if (!dest) return false
  try {
    await withLoading(t("loading.exportingPack", { pack: pack.name }), async (update) => {
      const unlisten = await onExportProgress((p) =>
        update({ progress: Math.round((p.index / p.total) * 100) }),
      )
      try {
        await exportUserPack(pack.id, dest)
      } finally {
        unlisten()
      }
    })
    toaster.create({
      type: "success",
      title: t("userPacks.exported", { pack: pack.name }),
      description: t("userPacks.exportedHint"),
    })
    return true
  } catch (e) {
    toaster.create({ type: "error", title: t("userPacks.exportError"), description: String(e) })
    return false
  }
}
