import { useEffect, useState } from "react"
import i18n from "../../i18n"
import { withLoading } from "../../stores/loadingStore"
import { usePacksStore } from "../../stores/packsStore"
import { ESSENTIALS_PACK_ID } from "../packs/essentials"
import { latestVersion, type Open20Page } from "./api"
import { isNewer } from "./version"

/** One check per product and session, shared by whoever asks. */
const checks = new Map<Open20Page, Promise<string | null>>()

function latestOnce(product: Open20Page): Promise<string | null> {
  let check = checks.get(product)
  if (!check) {
    check = withLoading(i18n.t("loading.checkingUpdates"), () => latestVersion(product))
      // Offline, or outside the desktop app: simply nothing to say.
      .catch(() => null)
    checks.set(product, check)
  }
  return check
}

/** The latest published version of a product (null until known, or if it can't be). */
function useLatest(product: Open20Page): string | null {
  const [latest, setLatest] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      const v = await latestOnce(product)
      if (!alive) return
      setLatest(v)
    }
    void load()
    return () => {
      alive = false
    }
  }, [product])
  return latest
}

/** A newer Battle Maps than this one, or null. */
export function useNewVersion(): string | null {
  const latest = useLatest("battle-maps")
  return latest && isNewer(latest, __APP_VERSION__) ? latest : null
}

/** A newer Open20 Essentials than the installed one, or null (also when it isn't installed). */
export function useNewEssentials(): string | null {
  const latest = useLatest("essentials")
  const installed = usePacksStore(
    (s) => s.packs.find((p) => p.id === ESSENTIALS_PACK_ID)?.version ?? null,
  )
  return latest && installed && isNewer(latest, installed) ? latest : null
}
