import { useId, useState } from "react"
import {
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  Input,
  Switch,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuPlus, LuRotateCcw, LuX } from "react-icons/lu"
import { ColorPickerPopover } from "../../ui/ColorPickerPopover"
import { Tooltip } from "../../ui/chakra/tooltip"
import { type AssetCategory } from "../../lib/categories"
import { FieldLabel } from "./AdjustFields"
import { CATEGORY_SPECS } from "./userAssets"

/** The descriptive fields of one asset or many (undefined = mixed). */
export interface MetaValues {
  folder?: string
  tags?: string[]
  colorable?: boolean
  color?: string | null
}

/**
 * Where an asset is filed and how it takes color: objects' folder, tags
 * (typed, or picked from the pack's), colorable and the default tint —
 * each shown only for the categories that have it.
 */
export function AssetMetaFields({
  category,
  values,
  onChange,
  folders = [],
  knownTags = [],
}: {
  category: AssetCategory
  values: MetaValues
  onChange: (patch: Partial<MetaValues>) => void
  /** Folders already in the pack (suggested). */
  folders?: readonly string[]
  /** Tags already in the pack (one click adds them). */
  knownTags?: readonly string[]
}) {
  const spec = CATEGORY_SPECS[category]
  return (
    <VStack align="stretch" gap="3">
      {spec.folder && (
        <FolderField
          value={values.folder}
          folders={folders}
          onChange={(folder) => onChange({ folder })}
        />
      )}
      <TagsField tags={values.tags} knownTags={knownTags} onChange={(tags) => onChange({ tags })} />
      {spec.colorable && (
        <ColorableField
          value={values.colorable}
          onChange={(colorable) => onChange({ colorable })}
        />
      )}
      {spec.color && <ColorField value={values.color} onChange={(color) => onChange({ color })} />}
    </VStack>
  )
}

/** " · Mixed" after a switch's label when the assets differ. */
function MixedNote({ mixed }: { mixed: boolean }) {
  const { t } = useTranslation()
  if (!mixed) return null
  return (
    <Text as="span" color="fg.muted">
      {" "}
      · {t("userPacks.mixed")}
    </Text>
  )
}

function FolderField({
  value,
  folders,
  onChange,
}: {
  value: string | undefined
  folders: readonly string[]
  onChange: (folder: string) => void
}) {
  const { t } = useTranslation()
  const listId = useId()
  return (
    <Box>
      <FieldLabel>{t("userPacks.folder")}</FieldLabel>
      <Input
        mt="1"
        size="sm"
        list={listId}
        aria-label={t("userPacks.folder")}
        value={value ?? ""}
        placeholder={value === undefined ? t("userPacks.mixed") : t("userPacks.folderHint")}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      <datalist id={listId}>
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </Box>
  )
}

function TagsField({
  tags,
  knownTags,
  onChange,
}: {
  /** undefined: the assets have different tags. */
  tags: string[] | undefined
  knownTags: readonly string[]
  onChange: (tags: string[]) => void
}) {
  const { t } = useTranslation()
  const [input, setInput] = useState("")
  const add = (raw: string[]) => {
    const fresh = raw.map((x) => x.trim()).filter(Boolean)
    if (fresh.length > 0) onChange([...new Set([...(tags ?? []), ...fresh])])
  }
  const have = new Set(tags ?? [])
  const suggested = knownTags.filter((k) => !have.has(k)).slice(0, 12)

  return (
    <Box>
      <FieldLabel>{t("userPacks.tags")}</FieldLabel>
      {tags === undefined ? (
        <Text fontSize="xs" color="fg.muted" mt="1">
          {t("userPacks.mixedTags")}
        </Text>
      ) : (
        <TagChips tags={tags} onRemove={(tag) => onChange(tags.filter((x) => x !== tag))} />
      )}
      <HStack mt="1.5" gap="1">
        <Input
          size="sm"
          value={input}
          placeholder={t("userPacks.tagPlaceholder")}
          aria-label={t("userPacks.addTag")}
          onChange={(e) => {
            // A comma closes a tag (typing "a, b" adds both).
            const parts = e.currentTarget.value.split(",")
            add(parts.slice(0, -1))
            setInput(parts[parts.length - 1])
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return
            add([input])
            setInput("")
          }}
        />
        <IconButton
          aria-label={t("userPacks.addTag")}
          size="sm"
          variant="subtle"
          disabled={!input.trim()}
          onClick={() => {
            add([input])
            setInput("")
          }}
        >
          <LuPlus />
        </IconButton>
      </HStack>
      {suggested.length > 0 && (
        <Wrap gap="1" mt="1.5">
          {suggested.map((tag) => (
            <Button key={tag} size="2xs" variant="outline" onClick={() => add([tag])}>
              <LuPlus />
              {tag}
            </Button>
          ))}
        </Wrap>
      )}
    </Box>
  )
}

function TagChips({ tags, onRemove }: { tags: string[]; onRemove: (tag: string) => void }) {
  const { t } = useTranslation()
  if (tags.length === 0) return null
  return (
    <Wrap gap="1" mt="1.5">
      {tags.map((tag) => (
        <HStack
          key={tag}
          gap="0.5"
          pl="2"
          pr="0.5"
          py="0.5"
          borderRadius="full"
          bg="brand.subtle"
          color="brand.fg"
          fontSize="xs"
        >
          <Text>{tag}</Text>
          <IconButton
            aria-label={t("userPacks.removeTag", { tag })}
            size="2xs"
            variant="ghost"
            minW="5"
            h="5"
            onClick={() => onRemove(tag)}
          >
            <LuX />
          </IconButton>
        </HStack>
      ))}
    </Wrap>
  )
}

function ColorableField({
  value,
  onChange,
}: {
  value: boolean | undefined
  onChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Box>
      <Switch.Root
        size="sm"
        colorPalette="brand"
        checked={value ?? false}
        onCheckedChange={(e) => onChange(e.checked)}
      >
        <Switch.HiddenInput />
        <Switch.Control />
        <Switch.Label fontSize="sm">
          {t("userPacks.colorable")}
          <MixedNote mixed={value === undefined} />
        </Switch.Label>
      </Switch.Root>
      <Text fontSize="2xs" color="fg.subtle" mt="1">
        {t("userPacks.colorableHint")}
      </Text>
    </Box>
  )
}

function ColorField({
  value,
  onChange,
}: {
  /** undefined: mixed; null: none. */
  value: string | null | undefined
  onChange: (c: string | null) => void
}) {
  const { t } = useTranslation()
  const label = value === undefined ? t("userPacks.mixed") : (value ?? t("userPacks.noColor"))
  return (
    <Box>
      <FieldLabel>{t("userPacks.defaultColor")}</FieldLabel>
      <HStack mt="1" gap="1.5">
        <Box flex="1">
          <ColorPickerPopover value={value ?? "#ffffff"} onCommit={onChange}>
            <Flex
              as="button"
              w="full"
              h="30px"
              align="center"
              px="2"
              bg={value ?? "#ffffff"}
              borderWidth="1px"
              borderColor="panel.border"
              borderRadius="md"
              _hover={{ borderColor: "brand.fg" }}
            >
              <Text fontSize="xs" px="1.5" borderRadius="sm" bg="blackAlpha.600" color="white">
                {label}
              </Text>
            </Flex>
          </ColorPickerPopover>
        </Box>
        <Tooltip content={t("userPacks.clearColor")} showArrow>
          <IconButton
            aria-label={t("userPacks.clearColor")}
            size="sm"
            variant="ghost"
            onClick={() => onChange(null)}
          >
            <LuRotateCcw />
          </IconButton>
        </Tooltip>
      </HStack>
    </Box>
  )
}
