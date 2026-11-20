import { useEffect } from "react"
import { usePacksStore } from "../../stores/packsStore"
import { ESSENTIALS_PACK_ID } from "./essentials"

/** Whether Open20 Essentials isn't installed (false until the pack list is known). */
export function useEssentialsMissing(): boolean {
  const ensureLoaded = usePacksStore((s) => s.ensureLoaded)
  useEffect(() => ensureLoaded(), [ensureLoaded])
  return usePacksStore((s) => s.loaded && !s.packs.some((p) => p.id === ESSENTIALS_PACK_ID))
}
