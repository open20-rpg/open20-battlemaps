import i18n from "../../../i18n"
import { withLoading } from "../../../stores/loadingStore"
import { readImageFile } from "../api"

/**
 * Reference images live anywhere on disk (outside the asset-protocol scope),
 * so they're read through the backend as data URLs. Cached by path; the
 * canvas subscribes to redraw once a load finishes.
 */
const cache = new Map<string, string | "loading" | "error">()
const listeners = new Set<() => void>()

export function subscribeReferenceImages(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The loaded data URL for `path`, starting the load if needed (null until ready). */
export function referenceImageUrl(path: string): string | null {
  const cached = cache.get(path)
  if (cached === undefined) {
    cache.set(path, "loading")
    withLoading(i18n.t("loading.loadingAssets"), () => readImageFile(path))
      .then((url) => cache.set(path, url))
      .catch(() => cache.set(path, "error"))
      .finally(() => {
        for (const l of listeners) l()
      })
    return null
  }
  return cached === "loading" || cached === "error" ? null : cached
}
