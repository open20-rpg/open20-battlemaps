import { useEffect, useState } from "react"
import { Badge, Box, Button, Flex, HStack, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuDownload, LuImagePlus, LuInfo, LuPackageOpen } from "react-icons/lu"
import { FloatingWindow } from "../../../ui/FloatingWindow"
import { Select } from "../../../ui/Select"
import { useIsPhone } from "../../../ui/useIsPhone"
import { toaster } from "../../../ui/chakra/toaster-instance"
import { withLoading } from "../../../stores/loadingStore"
import { usePacksStore } from "../../../stores/packsStore"
import { type AssetCategory } from "../../../lib/categories"
import { DEFAULT_CUSTOM_COLOR } from "../../../lib/colors"
import { AssetSelector } from "../../library/AssetSelector"
import { updateUserPack, userPackInfo, type InstalledPack, type UserPackInfo } from "../api"
import { exportPack } from "../exportPack"
import { startImport } from "../importFlow"
import { PackMetaForm } from "../PackMetaForm"
import { IMPORT_CATEGORIES, categoryOfAssetId } from "../userAssets"
import { AssetProperties } from "./AssetProperties"

/** The pack editor, open while the store names a user pack. */
export function PackEditorHost() {
  const id = usePacksStore((s) => s.editorPackId)
  const pack = usePacksStore((s) => s.packs.find((p) => p.id === id && p.editable) ?? null)
  const close = usePacksStore((s) => s.closeEditor)
  return pack ? <PackEditor key={pack.id} pack={pack} onClose={close} /> : null
}

/**
 * Edit a pack made in the app: browse its assets by type, add images, adjust
 * or delete what's there, change its details and export it for Dungeondraft.
 */
function PackEditor({ pack, onClose }: { pack: InstalledPack; onClose: () => void }) {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const libraryRev = usePacksStore((s) => s.libraryRev)
  const addOrUpdate = usePacksStore((s) => s.addOrUpdate)
  const [category, setCategory] = useState<AssetCategory | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [showDetails, setShowDetails] = useState(false)
  const [savingMeta, setSavingMeta] = useState(false)
  const [info, setInfo] = useState<UserPackInfo | null>(null)

  // Counts, folders and tags: again whenever the library changed (imports, edits).
  useEffect(() => {
    let alive = true
    userPackInfo(pack.id)
      .then((res) => alive && setInfo(res))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [pack.id, libraryRev])

  // Open on the first type that has something (objects for an empty pack).
  const shown: AssetCategory =
    category ?? IMPORT_CATEGORIES.find((c) => (info?.counts[c] ?? 0) > 0) ?? "objects"
  const total = Object.values(info?.counts ?? {}).reduce((a, b) => a + b, 0)

  const choose = (c: AssetCategory) => {
    setCategory(c)
    setSelected([])
  }

  const importHere = () =>
    void startImport({
      category: shown,
      packId: pack.id,
      // Show what came in: its type, selected.
      onImported: (ids) => {
        const c = ids[0] ? categoryOfAssetId(ids[0]) : null
        if (!c) return
        setCategory(c)
        setSelected(ids.filter((id) => categoryOfAssetId(id) === c))
        setShowDetails(false)
      },
    })

  const saveMeta = async (meta: Parameters<typeof updateUserPack>[1]) => {
    setSavingMeta(true)
    try {
      const updated = await withLoading(t("loading.updatingPacks"), () =>
        updateUserPack(pack.id, meta),
      )
      addOrUpdate([updated])
      toaster.create({ type: "success", title: t("userPacks.detailsSaved") })
    } finally {
      setSavingMeta(false)
    }
  }

  const toolbar = (
    <HStack
      px="3"
      py="2"
      gap="2"
      borderBottomWidth="1px"
      borderColor="panel.border"
      flexWrap="wrap"
    >
      <Button size="xs" colorPalette="brand" onClick={importHere}>
        <LuImagePlus />
        {t("userPacks.addImages")}
      </Button>
      <Button
        size="xs"
        variant="subtle"
        onClick={() => void exportPack(pack)}
        disabled={total === 0}
      >
        <LuDownload />
        {t("userPacks.export")}
      </Button>
      <Button
        size="xs"
        variant={showDetails ? "solid" : "subtle"}
        colorPalette={showDetails ? "brand" : undefined}
        onClick={() => setShowDetails((v) => !v)}
        aria-pressed={showDetails}
      >
        <LuInfo />
        {t("userPacks.details")}
      </Button>
      <Box flex="1" />
      {!pack.enabled && (
        <Badge colorPalette="gray" variant="subtle">
          {t("assets.inactive")}
        </Badge>
      )}
    </HStack>
  )

  const categories = phone ? (
    <Box px="3" pt="3">
      <Select
        value={shown}
        items={IMPORT_CATEGORIES.map((c) => ({
          value: c,
          label: `${t(`userPacks.category.${c}`)} (${info?.counts[c] ?? 0})`,
        }))}
        onChange={(v) => choose(v as AssetCategory)}
      />
    </Box>
  ) : (
    <VStack
      align="stretch"
      gap="0.5"
      w="180px"
      flexShrink={0}
      p="2"
      borderRightWidth="1px"
      borderColor="panel.border"
      overflowY="auto"
    >
      {IMPORT_CATEGORIES.map((c) => {
        const n = info?.counts[c] ?? 0
        const active = c === shown
        return (
          <Flex
            key={c}
            as="button"
            align="center"
            gap="2"
            px="2.5"
            py="1.5"
            borderRadius="md"
            textAlign="left"
            bg={active ? "panel.rowSelected" : "transparent"}
            color={active ? "brand.fg" : n > 0 ? "fg" : "fg.muted"}
            _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
            onClick={() => choose(c)}
            aria-current={active}
          >
            <Text flex="1" fontSize="sm" truncate>
              {t(`userPacks.category.${c}`)}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {n}
            </Text>
          </Flex>
        )
      })}
    </VStack>
  )

  const grid = (
    <Flex direction="column" flex="1" minW="0" minH={phone ? "300px" : "0"}>
      <AssetSelector
        browserKey={`pack-editor:${pack.id}:${shown}`}
        category={shown}
        packId={pack.id}
        color={DEFAULT_CUSTOM_COLOR}
        select="multi"
        selectedIds={selected}
        onSelectionChange={(ids) => {
          setSelected(ids)
          setShowDetails(false)
        }}
        onImport={importHere}
        emptyHint={t("userPacks.emptyTypeHint")}
      />
      {selected.length === 0 && total > 0 && (
        <Text
          fontSize="2xs"
          color="fg.subtle"
          px="3"
          py="1.5"
          borderTopWidth="1px"
          borderColor="panel.border"
        >
          {t("userPacks.selectHint")}
        </Text>
      )}
    </Flex>
  )

  const side = showDetails ? (
    <Box p="4">
      <PackMetaForm
        key={`${pack.id}:${pack.name}:${pack.version}`}
        pack={pack}
        submitLabel={t("userPacks.saveDetails")}
        busy={savingMeta}
        onSubmit={(m) => void saveMeta(m)}
      />
    </Box>
  ) : selected.length > 0 ? (
    <AssetProperties
      ids={selected}
      category={shown}
      packInfo={info}
      onIdsChange={setSelected}
      stickyPreview={phone}
    />
  ) : (
    <VStack p="6" gap="2" color="fg.muted" textAlign="center">
      <LuPackageOpen size={28} />
      <Text fontSize="sm">{t("userPacks.nothingSelected")}</Text>
      <Text fontSize="xs" color="fg.subtle">
        {t("userPacks.nothingSelectedHint")}
      </Text>
    </VStack>
  )

  return (
    <FloatingWindow
      title={t("userPacks.editorTitle", { pack: pack.name })}
      icon={LuPackageOpen}
      onClose={onClose}
      initialSize={{ w: 1000, h: 640 }}
      minSize={{ w: 360, h: 400 }}
      resizable
      modal
      toolbar={toolbar}
    >
      {phone ? (
        <Flex direction="column" flex="1" minH="0" overflowY="auto">
          {categories}
          {grid}
          <Box borderTopWidth="1px" borderColor="panel.border">
            {side}
          </Box>
        </Flex>
      ) : (
        <Flex flex="1" minH="0">
          {categories}
          {grid}
          <Box
            w="320px"
            flexShrink={0}
            overflowY="auto"
            borderLeftWidth="1px"
            borderColor="panel.border"
          >
            {side}
          </Box>
        </Flex>
      )}
    </FloatingWindow>
  )
}
