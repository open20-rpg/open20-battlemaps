import { useState } from "react"
import { useTranslation } from "react-i18next"
import { withLoading } from "../../../stores/loadingStore"
import { usePacksStore } from "../../../stores/packsStore"
import {
  cancelPackOptimize,
  onOptimizeProgress,
  optimizePack,
  type InstalledPack,
  type OptimizeProgress,
  type OptimizeReport,
} from "../api"

export type OptimizeStep = "confirm" | "running" | "done"

/**
 * Optimizing packs one after another: progress (window and status bar),
 * stopping between batches, and each pack's result.
 */
export function useOptimizeRun(packs: readonly InstalledPack[]) {
  const { t } = useTranslation()
  const addOrUpdate = usePacksStore((s) => s.addOrUpdate)
  const [step, setStep] = useState<OptimizeStep>("confirm")
  const [progress, setProgress] = useState<OptimizeProgress | null>(null)
  const [reports, setReports] = useState<OptimizeReport[]>([])
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setStep("running")
    const done: OptimizeReport[] = []
    try {
      await withLoading(t("loading.optimizingPacks"), async (update) => {
        const unlisten = await onOptimizeProgress((p) => {
          setProgress(p)
          update({
            message: t("loading.optimizingPack", { pack: p.pack }),
            progress: Math.round((p.index / Math.max(1, p.total)) * 100),
          })
        })
        try {
          for (const pack of packs) {
            const report = await optimizePack(pack.id)
            done.push(report)
            addOrUpdate([report.pack])
            if (report.cancelled) break
          }
        } finally {
          unlisten()
        }
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setReports(done)
      setStep("done")
    }
  }

  const stop = () => {
    setStopping(true)
    void cancelPackOptimize()
  }

  return { step, progress, reports, stopping, error, run, stop }
}
