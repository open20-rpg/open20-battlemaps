import { useState } from "react"
import { useTranslation } from "react-i18next"
import { withLoading } from "../../../stores/loadingStore"
import { usePacksStore } from "../../../stores/packsStore"
import { toaster } from "../../../ui/chakra/toaster-instance"
import {
  createUserPack,
  importUserAssets,
  onImportProgress,
  type ImportItem,
  type ImportQuality,
} from "../api"
import { NEW_PACK, rememberPack } from "./useDestination"

export interface ImportFailure {
  name: string
  error: string
}

/**
 * Running an import: create the destination pack if it's new, send the
 * items (processed one by one on a worker thread, progress in the status
 * bar and the window), and report. Resolves the pack id when nothing could
 * be imported, so the window stays on it.
 */
export function useImportRun({
  onImported,
  onDone,
}: {
  onImported?: (ids: string[]) => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const addOrUpdate = usePacksStore((s) => s.addOrUpdate)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null)
  const [failures, setFailures] = useState<ImportFailure[]>([])

  const send = async (dest: string, newName: string, items: ImportItem[], q: ImportQuality) => {
    const packId =
      dest === NEW_PACK
        ? (await createUserPack({ name: newName, author: "", version: "", keywords: [] })).id
        : dest
    const report = await importUserAssets(packId, items, q)
    rememberPack(packId)
    addOrUpdate([report.pack])
    return { packId, report }
  }

  const run = async (
    dest: string,
    newName: string,
    items: ImportItem[],
    quality: ImportQuality,
  ): Promise<string | null> => {
    setBusy(true)
    setFailures([])
    try {
      return await withLoading(t("loading.importingAssets"), async (update) => {
        const unlisten = await onImportProgress((p) => {
          setProgress({ index: p.index, total: p.total })
          update({
            message: t("loading.importingAsset", { name: p.name, index: p.index, total: p.total }),
            progress: Math.round((p.index / p.total) * 100),
          })
        })
        try {
          const { packId, report } = await send(dest, newName, items, quality)
          const done = report.imported.length
          if (done === 0) {
            setFailures(report.failed)
            return packId
          }
          toaster.create({
            type: report.failed.length > 0 ? "warning" : "success",
            title: t("userPacks.imported", { count: done, pack: report.pack.name }),
            description:
              report.failed.length > 0
                ? t("userPacks.importedSomeFailed", { count: report.failed.length })
                : undefined,
          })
          onImported?.(report.imported)
          onDone()
          return null
        } finally {
          unlisten()
        }
      })
    } catch (e) {
      setFailures([{ name: newName, error: String(e) }])
      return null
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return { busy, progress, failures, run }
}
