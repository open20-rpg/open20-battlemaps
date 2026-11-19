import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { usePacksStore } from "../../../stores/packsStore"
import { userPackInfo, type UserPackInfo } from "../api"

/** "Create a new pack" in the destination list. */
export const NEW_PACK = "\u0000new"

/** The pack last imported into this session: the next import offers it first. */
let lastPackId: string | null = null

export function rememberPack(id: string) {
  lastPackId = id
}

/**
 * Where the import goes: one of the user's packs (the one asked for, else
 * the last one used) or a new one, and that pack's folders and tags.
 */
export function useDestination(requested?: string) {
  const { t } = useTranslation()
  const packs = usePacksStore((s) => s.packs)
  const ensureLoaded = usePacksStore((s) => s.ensureLoaded)
  useEffect(() => ensureLoaded(), [ensureLoaded])
  const editable = useMemo(() => packs.filter((p) => p.editable), [packs])

  const preferred = requested ?? lastPackId
  const [choice, setChoice] = useState<string | null>(null)
  const dest = choice ?? (editable.find((p) => p.id === preferred) ?? editable[0])?.id ?? NEW_PACK
  const [newName, setNewName] = useState(() => t("userPacks.defaultPackName"))

  const [info, setInfo] = useState<{ id: string; info: UserPackInfo } | null>(null)
  useEffect(() => {
    if (dest === NEW_PACK) return
    let alive = true
    const load = async () => {
      const res = await userPackInfo(dest)
      if (!alive) return
      setInfo({ id: dest, info: res })
    }
    load().catch(() => undefined)
    return () => {
      alive = false
    }
  }, [dest])

  const name =
    dest === NEW_PACK ? newName.trim() : (editable.find((p) => p.id === dest)?.name ?? "")
  return {
    editable,
    dest,
    setDest: setChoice,
    newName,
    setNewName,
    /** The destination's name (empty: can't import yet). */
    name,
    info: info?.id === dest ? info.info : null,
  }
}
