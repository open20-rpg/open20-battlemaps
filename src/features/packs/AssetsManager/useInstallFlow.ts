import { useEffect, useEffectEvent, useRef, useState } from "react"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { useLoadingStore } from "../../../stores/loadingStore"
import {
  installPacks,
  onInstallProgress,
  pickPackFiles,
  type InstalledPack,
  type InstallProgress,
} from "../api"

/**
 * Encapsulates the pack-install flow: native file picking, the install call
 * and its progress events, reported both locally (`progress`) and through the
 * global loading store.
 */
export function useInstallFlow(onInstalled: (packs: InstalledPack[]) => void) {
  const { t } = useTranslation()
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const installTaskRef = useRef<string | null>(null)

  // Effect Event: the long-lived progress listener always sees the latest `t`
  // without re-subscribing on every render.
  const handleProgress = useEffectEvent((p: InstallProgress) => {
    setProgress(p)
    if (installTaskRef.current) {
      useLoadingStore.getState().update(installTaskRef.current, {
        message: t("loading.installingPack", { pack: p.pack }),
        progress: p.percent,
      })
    }
  })

  // Coalesce bursts of progress events into at most one UI update per frame:
  // applying each one as it arrives would queue a React render per event and
  // keep the main thread from handling input until the queue drains.
  useEffect(() => {
    let latest: InstallProgress | null = null
    let frame = 0
    const flush = () => {
      frame = 0
      if (latest) handleProgress(latest)
      latest = null
    }
    const unlisten = onInstallProgress((p) => {
      latest = p
      if (!frame) frame = requestAnimationFrame(flush)
    })
    return () => {
      cancelAnimationFrame(frame)
      unlisten.then((fn) => fn())
    }
  }, [])

  const install = async () => {
    const paths = await pickPackFiles()
    if (paths.length === 0) return
    setInstalling(true)
    setProgress(null)
    const { start, stop } = useLoadingStore.getState()
    const taskId = start(t("loading.installingAssets"))
    installTaskRef.current = taskId
    try {
      const installed = await installPacks(paths)
      // Merge into the cache instead of re-listing.
      onInstalled(installed)
    } catch (err) {
      await confirm(t("assets.installError", { error: String(err) }), {
        title: t("assets.errorTitle"),
        kind: "error",
      })
    } finally {
      installTaskRef.current = null
      stop(taskId)
      setInstalling(false)
      setProgress(null)
    }
  }

  return { installing, progress, install }
}
