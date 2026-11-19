import { Box, Button, Flex, HStack, IconButton, Input, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuFileImage, LuX } from "react-icons/lu"
import { Select } from "../../../ui/Select"
import { type AssetCategory } from "../../../lib/categories"
import { thumbUrl } from "../../library/api"
import { pickImageFiles, type UserPackInfo } from "../api"
import { AdjustFields, FieldLabel, type AdjustTarget } from "../AdjustFields"
import { AssetMetaFields, type MetaValues } from "../AssetMetaFields"
import { CATEGORY_SPECS, IMPORT_CATEGORIES, fileName, sharedValue } from "../userAssets"
import { type Draft } from "./drafts"
import { type useDrafts } from "./useDrafts"
import { isPreview, type PreviewState } from "./useImportPreviews"

/**
 * Settings of the images being edited (one, or several at once): name,
 * type, parts, size and orientation, folder, tags and color. Every field
 * shows the shared value, or "mixed"; a change applies to all of them.
 */
export function ImportSettings({
  list,
  previews,
  packInfo,
}: {
  list: ReturnType<typeof useDrafts>
  previews: ReadonlyMap<string, PreviewState>
  packInfo: UserPackInfo | null
}) {
  const { t } = useTranslation()
  const { editing, patch } = list
  if (editing.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" p="4">
        {t("userPacks.pickToEdit")}
      </Text>
    )
  }
  const single = editing.length === 1 ? editing[0] : null
  const category = sharedValue(editing, (d) => d.category)
  const targets: AdjustTarget[] = editing.flatMap((d) => {
    const p = previews.get(d.source)
    return isPreview(p)
      ? [{ width: p.width, height: p.height, bounds: p.bounds, adjust: d.adjust }]
      : []
  })
  const meta: MetaValues = {
    folder: sharedValue(editing, (d) => d.folder),
    tags: sharedValue(editing, (d) => d.tags),
    colorable: sharedValue(editing, (d) => d.colorable),
    color: sharedValue(editing, (d) => d.color),
  }

  return (
    <VStack align="stretch" gap="4" p="4">
      {single ? (
        <Box>
          <FieldLabel>{t("userPacks.name")}</FieldLabel>
          <Input
            mt="1"
            size="sm"
            value={single.name}
            aria-label={t("userPacks.name")}
            onChange={(e) => {
              const name = e.currentTarget.value
              patch((d) => ({ ...d, name }))
            }}
          />
        </Box>
      ) : (
        <Text fontSize="xs" color="brand.fg" fontWeight="semibold">
          {t("userPacks.bulkEditing", { count: editing.length })}
        </Text>
      )}
      <CategoryField category={category} onChange={list.setCategory} />
      {single && CATEGORY_SPECS[single.category].parts.length > 0 && (
        <PartsFields
          draft={single}
          previews={previews}
          onChange={(parts) => patch((d) => ({ ...d, parts }))}
        />
      )}
      <AdjustFields targets={targets} onPatch={(f) => list.patchAdjust(previews, f)} />
      {category && (
        <AssetMetaFields
          category={category}
          values={meta}
          folders={packInfo?.folders}
          knownTags={packInfo?.tags}
          onChange={(m) => patch((d) => ({ ...d, ...m }))}
        />
      )}
    </VStack>
  )
}

function CategoryField({
  category,
  onChange,
}: {
  category: AssetCategory | undefined
  onChange: (c: AssetCategory) => void
}) {
  const { t } = useTranslation()
  return (
    <Box>
      <FieldLabel>{t("userPacks.type")}</FieldLabel>
      <Box mt="1">
        <Select
          value={category ?? ""}
          items={[
            ...(category ? [] : [{ value: "", label: t("userPacks.mixed"), disabled: true }]),
            ...IMPORT_CATEGORIES.map((c) => ({ value: c, label: t(`userPacks.category.${c}`) })),
          ]}
          onChange={(v) => onChange(v as AssetCategory)}
        />
      </Box>
      {category && (
        <Text fontSize="2xs" color="fg.subtle" mt="1">
          {t(`userPacks.categoryHint.${category}`)}
        </Text>
      )}
    </Box>
  )
}

/** A multi-texture item's extra images (a wall's end cap, a roof's ridge…). */
function PartsFields({
  draft,
  previews,
  onChange,
}: {
  draft: Draft
  previews: ReadonlyMap<string, PreviewState>
  onChange: (parts: Record<string, string>) => void
}) {
  const { t } = useTranslation()
  return (
    <Box>
      <FieldLabel>{t("userPacks.parts")}</FieldLabel>
      <VStack align="stretch" gap="1.5" mt="1.5">
        {CATEGORY_SPECS[draft.category].parts.map((part) => (
          <PartRow
            key={part}
            part={part}
            source={draft.parts[part]}
            preview={draft.parts[part] ? previews.get(draft.parts[part]) : undefined}
            onPick={(file) => onChange({ ...draft.parts, [part]: file })}
            onRemove={() => {
              const next = { ...draft.parts }
              delete next[part]
              onChange(next)
            }}
          />
        ))}
      </VStack>
      <Text fontSize="2xs" color="fg.subtle" mt="1.5">
        {t(`userPacks.partsHint.${draft.category}`)}
      </Text>
    </Box>
  )
}

function PartRow({
  part,
  source,
  preview,
  onPick,
  onRemove,
}: {
  part: string
  source?: string
  preview?: PreviewState
  onPick: (file: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <HStack gap="2">
      <Flex
        boxSize="32px"
        flexShrink={0}
        align="center"
        justify="center"
        borderRadius="sm"
        bg="black/30"
        overflow="hidden"
        color="fg.subtle"
      >
        {isPreview(preview) ? (
          <img
            src={thumbUrl(preview.path)}
            alt=""
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        ) : (
          <LuFileImage />
        )}
      </Flex>
      <Box flex="1" minW="0">
        <Text fontSize="xs">{t(`userPacks.part.${part}`)}</Text>
        <Text fontSize="2xs" color="fg.muted" truncate>
          {source ? fileName(source) : t("userPacks.partMissing")}
        </Text>
      </Box>
      <Button
        size="2xs"
        variant="subtle"
        onClick={async () => {
          const [file] = await pickImageFiles(false)
          if (file) onPick(file)
        }}
      >
        {source ? t("userPacks.change") : t("userPacks.choose")}
      </Button>
      {source && (
        <IconButton
          aria-label={t("userPacks.removePart")}
          size="2xs"
          variant="ghost"
          onClick={onRemove}
        >
          <LuX />
        </IconButton>
      )}
    </HStack>
  )
}
