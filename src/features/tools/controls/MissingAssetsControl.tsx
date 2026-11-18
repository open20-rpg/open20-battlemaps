import { useState, useSyncExternalStore } from "react"
import { Badge, Box, Button, Flex, Icon, IconButton, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import {
  LuChevronLeft,
  LuChevronRight,
  LuCircleCheck,
  LuImageOff,
  LuReplace,
  LuScanSearch,
} from "react-icons/lu"
import { useMapStore } from "../../../stores/mapStore"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { AssetSelector } from "../../library/AssetSelector"
import { replaceAsset } from "../../map/commands"
import { findMissingAssets, suggestQuery, type MissingAsset } from "../../map/missingAssets"
import { type MapDocument } from "../../map/model/types"
import { assetCache } from "../../map/render/assets"
import { NO_FOCUS, type MissingFocus } from "../params"

/** Stable empty list for the store selector. */
const NO_ENTITIES: MapDocument["entities"] = []

/**
 * Replace Assets' panel: the map's missing assets, most used first. Picking
 * one shows its uses on the map (the behavior frames them) and opens what's
 * needed to fix it: step through its uses, and choose an installed asset of
 * the same kind to put in its place — everywhere, or just in the use shown.
 */
export function MissingAssetsControl({
  value,
  onChange,
}: {
  value: MissingFocus
  onChange: (value: MissingFocus) => void
}) {
  const { t } = useTranslation()
  const entities = useMapStore((s) => s.map?.entities ?? NO_ENTITIES)
  const levels = useMapStore((s) => s.map?.levels)
  const missingIds = useSyncExternalStore(assetCache.subscribe, assetCache.missingIds)
  const items = findMissingAssets(entities, (id) => missingIds.has(id))
  const focused = items.find((m) => m.id === value.asset) ?? null
  const uses = items.reduce((n, m) => n + m.entityIds.length, 0)

  if (items.length === 0) {
    return (
      <VStack gap="2" px="5" py="8" textAlign="center">
        <Icon as={LuCircleCheck} boxSize="8" color="brand.fg" />
        <Text fontSize="sm" fontWeight="semibold">
          {t("replaceAssets.noneTitle")}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {t("replaceAssets.noneHint")}
        </Text>
      </VStack>
    )
  }

  const levelName = (id: string | undefined) => {
    const i = levels?.findIndex((l) => l.id === id) ?? -1
    return i < 0 ? "" : levels?.[i].name || t("levels.unnamed", { n: i + 1 })
  }

  return (
    <Flex direction="column" flex="1" minH="0">
      <Box px="3" pt="2" pb="1.5" flexShrink={0}>
        <Flex align="center" gap="2">
          <Text fontSize="xs" color="fg.muted" flex="1">
            {t("replaceAssets.title")}
          </Text>
          <Badge size="xs" colorPalette="brand" variant="subtle">
            {t("replaceAssets.summary", { count: items.length, uses })}
          </Badge>
        </Flex>
        {!focused && (
          <Text fontSize="xs" color="fg.muted" mt="1.5">
            {t("replaceAssets.hint")}
          </Text>
        )}
      </Box>
      <VStack
        align="stretch"
        gap="1"
        px="3"
        pb="2"
        overflowY="auto"
        flexShrink={focused ? 0 : 1}
        flex={focused ? undefined : "1"}
        maxH={focused ? "188px" : undefined}
        minH="0"
      >
        {items.map((item) => (
          <MissingRow
            key={item.id}
            item={item}
            selected={item.id === focused?.id}
            onClick={() =>
              onChange(item.id === focused?.id ? NO_FOCUS : { asset: item.id, index: null })
            }
          />
        ))}
      </VStack>
      {focused && (
        <FocusedAsset
          key={focused.id}
          item={focused}
          index={value.index}
          levelName={levelName}
          onChange={onChange}
        />
      )}
    </Flex>
  )
}

/** Where a missing asset comes from, as shown under its name. */
function useSourceLabel(item: MissingAsset): string {
  const { t } = useTranslation()
  const kind = item.category ? t(`replaceAssets.category.${item.category}`) : null
  const from =
    item.source === "pack"
      ? t("replaceAssets.source.pack", { pack: item.packId })
      : t(`replaceAssets.source.${item.source}`)
  return kind ? `${kind} · ${from}` : from
}

function MissingRow({
  item,
  selected,
  onClick,
}: {
  item: MissingAsset
  selected: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const source = useSourceLabel(item)
  return (
    <Flex
      as="button"
      align="center"
      gap="2.5"
      px="2"
      py="1.5"
      borderWidth="1px"
      borderColor={selected ? "brand.fg" : "panel.border"}
      bg={selected ? "panel.rowSelected/50" : undefined}
      borderRadius="md"
      textAlign="left"
      cursor="pointer"
      _hover={{ bg: selected ? undefined : "panel.rowHover" }}
      aria-pressed={selected}
      onClick={(e) => {
        const row = e.currentTarget
        onClick()
        // Picking one shrinks the list to make room below: keep this row in sight.
        requestAnimationFrame(() => row.scrollIntoView({ block: "nearest" }))
      }}
    >
      <Flex
        boxSize="8"
        flexShrink={0}
        align="center"
        justify="center"
        borderRadius="sm"
        borderWidth="1px"
        borderStyle="dashed"
        borderColor={selected ? "brand.fg" : "panel.border"}
        color={selected ? "brand.fg" : "icon.muted"}
      >
        <Icon as={LuImageOff} boxSize="4" />
      </Flex>
      <Box flex="1" minW="0">
        <Text fontSize="sm" truncate textTransform="capitalize">
          {item.name}
        </Text>
        <Text fontSize="2xs" color="fg.muted" truncate>
          {source}
        </Text>
      </Box>
      <Tooltip content={t("replaceAssets.uses", { count: item.entityIds.length })} showArrow>
        <Badge size="sm" variant={selected ? "solid" : "subtle"} colorPalette="brand">
          {item.entityIds.length}
        </Badge>
      </Tooltip>
    </Flex>
  )
}

/** The picked missing asset: step through its uses and pick what replaces it. */
function FocusedAsset({
  item,
  index,
  levelName,
  onChange,
}: {
  item: MissingAsset
  index: number | null
  levelName: (id: string | undefined) => string
  onChange: (value: MissingFocus) => void
}) {
  const { t } = useTranslation()
  const [replacement, setReplacement] = useState<string | null>(null)
  const count = item.entityIds.length
  const entities = useMapStore((s) => s.map?.entities ?? NO_ENTITIES)
  const current = index === null ? null : entities.find((e) => e.id === item.entityIds[index])
  const step = (dir: 1 | -1) => {
    const next = index === null ? (dir === 1 ? 0 : count - 1) : (index + dir + count) % count
    onChange({ asset: item.id, index: next })
  }
  const replaceAll = () => {
    if (!replacement) return
    replaceAsset(item.id, replacement)
    onChange(NO_FOCUS)
  }
  const replaceCurrent = () => {
    if (!replacement || !current) return
    replaceAsset(item.id, replacement, [current.id])
    // The next use slides into this index: show it (or the last one).
    if (count > 1) onChange({ asset: item.id, index: Math.min(index ?? 0, count - 2) })
    else onChange(NO_FOCUS)
  }

  return (
    <Flex
      direction="column"
      flex="1"
      minH="0"
      borderTopWidth="1px"
      borderColor="panel.border"
      bg="panel.header"
    >
      <Box px="3" pt="2.5" pb="2" flexShrink={0}>
        <Text fontSize="xs" color="fg.muted" mb="1.5">
          {t("replaceAssets.locate")}
        </Text>
        <Flex align="center" gap="1">
          <IconButton
            aria-label={t("replaceAssets.previous")}
            size="xs"
            variant="subtle"
            onClick={() => step(-1)}
          >
            <LuChevronLeft />
          </IconButton>
          <Box flex="1" minW="0" textAlign="center" lineHeight="short">
            <Text fontSize="xs" fontWeight="semibold">
              {index === null
                ? t("replaceAssets.allUses", { count })
                : t("replaceAssets.useOf", { n: index + 1, count })}
            </Text>
            <Text fontSize="2xs" color="fg.muted" truncate>
              {current
                ? t("replaceAssets.onLevel", { level: levelName(current.level) })
                : t("replaceAssets.levelsCount", { count: Math.max(1, item.levels.length) })}
            </Text>
          </Box>
          <IconButton
            aria-label={t("replaceAssets.next")}
            size="xs"
            variant="subtle"
            onClick={() => step(1)}
          >
            <LuChevronRight />
          </IconButton>
          <Tooltip content={t("replaceAssets.showAll")} showArrow>
            <IconButton
              aria-label={t("replaceAssets.showAll")}
              size="xs"
              variant={index === null ? "solid" : "subtle"}
              colorPalette={index === null ? "brand" : undefined}
              onClick={() => onChange({ asset: item.id, index: null })}
            >
              <LuScanSearch />
            </IconButton>
          </Tooltip>
        </Flex>
      </Box>
      <Box px="3" pb="1" flexShrink={0}>
        <Text fontSize="xs" color="fg.muted">
          {t("replaceAssets.replaceWith", {
            kind: t(`replaceAssets.category.${item.category ?? "objects"}`),
          })}
        </Text>
        <Text fontSize="2xs" color="fg.muted" opacity={0.8}>
          {t("replaceAssets.suggestion")}
        </Text>
      </Box>
      <Flex direction="column" flex="1" minH="0">
        <AssetSelector
          browserKey="replaceAssets"
          category={item.category ?? "objects"}
          color="#ffffff"
          select="single"
          selectedIds={replacement ? [replacement] : []}
          initialQuery={suggestQuery(item.name)}
          onSelectionChange={(ids) => setReplacement(ids[0] ?? null)}
        />
      </Flex>
      <VStack align="stretch" gap="1.5" px="3" py="2.5" flexShrink={0}>
        <Button size="sm" colorPalette="brand" disabled={!replacement} onClick={replaceAll}>
          <LuReplace />
          {t("replaceAssets.replaceAll", { count })}
        </Button>
        {current && count > 1 && (
          <Button size="xs" variant="subtle" disabled={!replacement} onClick={replaceCurrent}>
            {t("replaceAssets.replaceThis")}
          </Button>
        )}
      </VStack>
    </Flex>
  )
}
