import { useState } from "react"
import i18n from "../../../i18n"
import { withLoading } from "../../../stores/loadingStore"
import { type GraphicsPreset } from "../../../lib/renderPerformance"
import { runGraphicsBenchmark, type PresetResult } from "./run"

/** The automatic graphics setup as UI state: run it and follow its results. */
export function useGraphicsBenchmark() {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<PresetResult[]>([])
  const [suggested, setSuggested] = useState<GraphicsPreset | null>(null)
  const [failed, setFailed] = useState(false)

  /** Measure every preset (from Low up); resolves the suggestion. */
  const run = async (): Promise<GraphicsPreset | null> => {
    setRunning(true)
    setResults([])
    setSuggested(null)
    setFailed(false)
    try {
      const result = await withLoading(i18n.t("perf.auto.running"), () =>
        runGraphicsBenchmark((r) => setResults((list) => [...list, r])),
      )
      setSuggested(result.suggested)
      return result.suggested
    } catch {
      setFailed(true)
      return null
    } finally {
      setRunning(false)
    }
  }

  return { running, results, suggested, failed, run }
}
