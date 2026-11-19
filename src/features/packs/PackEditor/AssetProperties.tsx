import { useEffect, useState } from "react"
import { Box, Button, Flex, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { LuSave, LuTrash2, LuUndo2 } from "react-icons/lu"
import { withLoading } from "../../../stores/loadingStore"
import { useMapStore } from "../../../stores/mapStore"
import { usePacksStore } from "../../../stores/packsStore"
import { type AssetCategory } from "../../../lib/categories"
import { formatBytes } from "../../../lib/format"
import { bustFiles, thumbUrl } from "../../library/api"
import { assetCache } from "../../map/render/assets"
import { usedAssetIds } from "../../map/packUsage"
import {
  deleteUserAssets,
  editUserAsset,
  userAssetInfo,
  type AssetEdit,
  type UserAssetInfo,
  type UserPackInfo,
} from "../api"
import { AdjustFields, FieldLabel } from "../AdjustFields"
import { AssetMetaFields, type MetaValues } from "../AssetMetaFields"
import { AssetPreview } from "../ImportAssets/AssetPreview"
import { NO_ADJUST, sharedValue, type Adjust } from "../userAssets"

/** What the user changed, per asset (absent = as it is). */
interface Changes {
  name?: string
  meta: MetaValues
  /** Per asset id: "fit to N cells" gives each its own scale. */
  adjusts: Record<string, Adjust>
}

const NO_CHANGES: Changes = { meta: {}, adjusts: {} }

const sameAdjust = (a: Adjust, b: Adjust) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Properties of the assets selected in a user pack's editor: preview (as
 * the change would leave it), name, size and orientation, folder, tags and
 * color — for one asset, or the shared ones of many. Changes apply on Save;
 * resizing re-processes the stored texture, keeping its file (and the maps
 * that use it).
 */
export function AssetProperties({
  ids,
  category,
  packInfo,
  onIdsChange,
  stickyPreview = false,
}: {
  ids: string[]
  category: AssetCategory
  packInfo: UserPackInfo | null
  /** Ids after a save (renaming changes them) or a delete. */
  onIdsChange: (ids: string[]) => void
  /** Keep the preview pinned while scrolling (the phone's stacked layout). */
  stickyPreview?: boolean
}) {
  const { t } = useTranslation()
  const addOrUpdate = usePacksStore((s) => s.addOrUpdate)
  const key = ids.join("\n")
  const [loaded, setLoaded] = useState<{ key: string; infos: UserAssetInfo[] } | null>(null)
  const [changes, setChanges] = useState<{ key: string; c: Changes }>({ key, c: NO_CHANGES })
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  // Another selection: forget the unsaved changes (during render, not in an effect).
  if (changes.key !== key) setChanges({ key, c: NO_CHANGES })
  const c = changes.key === key ? changes.c : NO_CHANGES
  const setC = (f: (c: Changes) => Changes) => setChanges((prev) => ({ key, c: f(prev.c) }))

  useEffect(() => {
    if (!key) return
    let alive = true
    const load = async () => {
      const infos = await Promise.all(key.split("\n").map((id) => userAssetInfo(id))).catch(
        () => [],
      )
      if (!alive) return
      setLoaded({ key, infos })
    }
    void load()
    return () => {
      alive = false
    }
  }, [key, reload])

  const infos = loaded?.key === key ? loaded.infos : null
  if (!infos) {
    return (
      <Flex justify="center" p="6">
        <Spinner color="brand.fg" />
      </Flex>
    )
  }
  if (infos.length === 0) return null

  const single = infos.length === 1 ? infos[0] : null
  const current: MetaValues = {
    folder: sharedValue(infos, (i) => i.folder),
    tags: sharedValue(infos, (i) => i.tags),
    colorable: sharedValue(infos, (i) => i.colorable),
    color: sharedValue(infos, (i) => i.color),
  }
  const meta: MetaValues = { ...current, ...c.meta }
  const adjustOf = (id: string) => c.adjusts[id] ?? NO_ADJUST
  const dirty =
    (c.name !== undefined && c.name.trim() !== single?.name) ||
    Object.keys(c.meta).length > 0 ||
    ids.some((id) => !sameAdjust(adjustOf(id), NO_ADJUST))

  const editFor = (id: string): AssetEdit => ({
    ...(single && c.name !== undefined ? { name: c.name.trim() } : {}),
    ...("folder" in c.meta ? { folder: c.meta.folder } : {}),
    ...("tags" in c.meta ? { tags: c.meta.tags } : {}),
    ...("colorable" in c.meta ? { colorable: c.meta.colorable } : {}),
    ...("color" in c.meta ? { color: c.meta.color ?? null } : {}),
    ...(sameAdjust(adjustOf(id), NO_ADJUST) ? {} : { adjust: adjustOf(id) }),
  })

  const usedHere = () => {
    const used = new Set(usedAssetIds(useMapStore.getState().map, category))
    return ids.filter((id) => used.has(id))
  }

  const save = async () => {
    const moves = (single && c.name !== undefined) || "folder" in c.meta
    if (moves && usedHere().length > 0) {
      const ok = await confirm(t("userPacks.renameUsedConfirm"), {
        title: t("userPacks.renameUsedTitle"),
        kind: "warning",
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      await withLoading(t("loading.savingAsset"), async () => {
        // The backend applies them one at a time (each takes the pack's lock).
        const results = await Promise.all(ids.map((id) => editUserAsset(id, editFor(id))))
        bustFiles(results.flatMap((r) => r.changedFiles))
        assetCache.forget([...ids, ...results.map((r) => r.id)])
        const last = results[results.length - 1]
        if (last) addOrUpdate([last.pack])
        onIdsChange(results.map((r) => r.id))
      })
      setChanges({ key: "", c: NO_CHANGES })
      setReload((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const used = usedHere().length
    const ok = await confirm(
      used > 0
        ? t("userPacks.deleteUsedConfirm", { count: ids.length })
        : t("userPacks.deleteAssetsConfirm", { count: ids.length }),
      { title: t("userPacks.deleteAssetsTitle"), kind: "warning" },
    )
    if (!ok) return
    setBusy(true)
    try {
      await withLoading(t("loading.deletingAssets"), async () => {
        const pack = await deleteUserAssets(ids)
        assetCache.forget(ids)
        if (pack) addOrUpdate([pack])
        onIdsChange([])
      })
    } finally {
      setBusy(false)
    }
  }

  const adjustTargets = infos.map((i) => ({
    id: i.id,
    width: i.width,
    height: i.height,
    adjust: adjustOf(i.id),
  }))

  return (
    <VStack align="stretch" gap="4" p="4">
      {single ? (
        <>
          <PreviewBand
            info={single}
            adjust={adjustOf(single.id)}
            category={category}
            sticky={stickyPreview}
          />
          <NameField
            info={single}
            value={c.name ?? single.name}
            onChange={(name) => setC((prev) => ({ ...prev, name }))}
          />
        </>
      ) : (
        <Text fontSize="xs" color="brand.fg" fontWeight="semibold">
          {t("userPacks.bulkEditing", { count: infos.length })}
        </Text>
      )}
      <AdjustFields
        targets={adjustTargets}
        showTrim={false}
        onPatch={(f) =>
          setC((prev) => ({
            ...prev,
            adjusts: Object.fromEntries(
              adjustTargets.map((x) => [x.id, f(prev.adjusts[x.id] ?? NO_ADJUST, x)]),
            ),
          }))
        }
      />
      <AssetMetaFields
        category={category}
        values={meta}
        folders={packInfo?.folders}
        knownTags={packInfo?.tags}
        onChange={(m) => setC((prev) => ({ ...prev, meta: { ...prev.meta, ...m } }))}
      />
      <HStack gap="2" pt="1" flexWrap="wrap">
        <Button
          size="sm"
          colorPalette="brand"
          flex="1"
          disabled={!dirty}
          loading={busy}
          onClick={() => void save()}
        >
          <LuSave />
          {t("userPacks.save")}
        </Button>
        <Button
          size="sm"
          variant="subtle"
          disabled={!dirty || busy}
          onClick={() => setChanges({ key, c: NO_CHANGES })}
        >
          <LuUndo2 />
          {t("userPacks.discard")}
        </Button>
      </HStack>
      <Button
        size="sm"
        variant="subtle"
        colorPalette="danger"
        disabled={busy}
        onClick={() => void remove()}
      >
        <LuTrash2 />
        {t("userPacks.deleteAssets", { count: infos.length })}
      </Button>
    </VStack>
  )
}

/** The asset as the change would leave it, on the grid. */
function PreviewBand({
  info,
  adjust,
  category,
  sticky,
}: {
  info: UserAssetInfo
  adjust: Adjust
  category: AssetCategory
  /** Stacked on a phone, it stays in view while the fields below scroll. */
  sticky: boolean
}) {
  return (
    <Box
      mx="-4"
      mt="-4"
      h={sticky ? "180px" : "200px"}
      display="flex"
      borderBottomWidth="1px"
      borderColor="panel.border"
      {...(sticky ? { position: "sticky", top: "0", zIndex: "1", bg: "panel.solid" } : {})}
    >
      <AssetPreview
        image={{ url: thumbUrl(info.path), width: info.width, height: info.height }}
        adjust={adjust}
        category={category}
      />
    </Box>
  )
}

/** Name of one asset, with its size, weight and parts. */
function NameField({
  info,
  value,
  onChange,
}: {
  info: UserAssetInfo
  value: string
  onChange: (name: string) => void
}) {
  const { t } = useTranslation()
  const parts = info.parts.map((p) => t(`userPacks.part.${p}`)).join(", ")
  return (
    <Box>
      <FieldLabel>{t("userPacks.name")}</FieldLabel>
      <Input
        mt="1"
        size="sm"
        value={value}
        aria-label={t("userPacks.name")}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      <Text fontSize="2xs" color="fg.subtle" mt="1">
        {t("userPacks.assetStats", {
          w: info.width,
          h: info.height,
          size: formatBytes(info.sizeBytes),
        })}
        {parts && ` · ${parts}`}
      </Text>
    </Box>
  )
}
