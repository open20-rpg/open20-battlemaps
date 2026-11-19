import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLoadingStore } from "../../../stores/loadingStore"
import { clearImportPreviews, importPreview, type ImportPreview } from "../api"

export type PreviewState = ImportPreview | { error: string }

/** Images decoded at once: each is decoded whole in Rust, so few at a time bound memory. */
const CONCURRENCY = 2

/**
 * Previews (size, content bounds, a small image file) of the picked images,
 * decoded in the background a couple at a time — a hundred images never sit
 * decoded in memory together, and the window is usable while they arrive.
 * Progress shows in the status bar. The preview files are deleted when the
 * window closes.
 */
export function useImportPreviews(sources: readonly string[]): ReadonlyMap<string, PreviewState> {
  const { t } = useTranslation()
  const [previews, setPreviews] = useState<ReadonlyMap<string, PreviewState>>(new Map())
  // The sources as a primitive key: a new-but-equal array mustn't restart.
  const key = sources.join("\n")
  // Already decoded (adding more images doesn't redo the first ones).
  const known = useRef(new Set<string>())

  useEffect(() => {
    const wanted = (key ? key.split("\n") : []).filter((s) => !known.current.has(s))
    let cancelled = false
    let done = 0
    const queue = [...wanted]
    const { start, update, stop } = useLoadingStore.getState()
    const task = wanted.length > 0 ? start(t("loading.preparingImages"), 0) : null
    const worker = async () => {
      for (let source = queue.shift(); source !== undefined; source = queue.shift()) {
        if (cancelled) return
        let result: PreviewState
        try {
          result = await importPreview(source)
        } catch (e) {
          result = { error: String(e) }
        }
        if (cancelled) return
        const src = source
        known.current.add(src)
        setPreviews((prev) => new Map(prev).set(src, result))
        done++
        if (task) update(task, { progress: Math.round((done / wanted.length) * 100) })
      }
    }
    void Promise.all(Array.from({ length: CONCURRENCY }, worker)).finally(() => {
      if (task) stop(task)
    })
    return () => {
      cancelled = true
      if (task) stop(task)
    }
  }, [key, t])

  // The preview files are only for this window.
  useEffect(() => () => void clearImportPreviews(), [])

  return previews
}

export function isPreview(p: PreviewState | undefined): p is ImportPreview {
  return !!p && !("error" in p)
}
