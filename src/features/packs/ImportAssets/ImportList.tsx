import { Box, Checkbox, Flex, HStack, Icon, IconButton, Spinner, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuCircleAlert, LuImagePlus, LuLayers, LuTrash2 } from "react-icons/lu"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { thumbUrl } from "../../library/api"
import { cellsOf, targetSize } from "../userAssets"
import { isPreview, type PreviewState } from "./useImportPreviews"
import { type Draft } from "./drafts"

/**
 * The images being imported. A click (or tap) on a row edits just that one;
 * its checkbox — or Ctrl/Shift-click — adds it to the ones being edited
 * together, and the header's checkbox takes them all.
 */
export function ImportList({
  drafts,
  previews,
  checked,
  focused,
  onRowClick,
  onToggle,
  onToggleAll,
  onAdd,
  onRemoveChecked,
  maxH,
}: {
  drafts: readonly Draft[]
  previews: ReadonlyMap<string, PreviewState>
  checked: ReadonlySet<string>
  focused: string | null
  onRowClick: (key: string, additive: boolean) => void
  onToggle: (key: string) => void
  onToggleAll: () => void
  onAdd: () => void
  onRemoveChecked: () => void
  /** Cap the list's height (the phone layout stacks it above the rest). */
  maxH?: string
}) {
  const { t } = useTranslation()
  const all = drafts.length > 0 && checked.size === drafts.length
  return (
    // Capped (stacked on a phone) it keeps its height instead of shrinking away.
    <Flex direction="column" minH="0" flex={maxH ? "none" : "1"}>
      <HStack
        px="3"
        py="1.5"
        gap="2"
        borderBottomWidth="1px"
        borderColor="panel.border"
        bg="panel.header"
        flexShrink={0}
      >
        <Checkbox.Root
          size="sm"
          colorPalette="brand"
          checked={all ? true : checked.size > 0 ? "indeterminate" : false}
          onCheckedChange={onToggleAll}
          aria-label={t("userPacks.selectAll")}
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
        </Checkbox.Root>
        <Text fontSize="xs" color="fg.muted" flex="1" truncate>
          {checked.size > 1
            ? t("userPacks.editingCount", { count: checked.size, total: drafts.length })
            : t("userPacks.imageCount", { count: drafts.length })}
        </Text>
        <Tooltip content={t("userPacks.addMore")} showArrow>
          <IconButton aria-label={t("userPacks.addMore")} size="xs" variant="ghost" onClick={onAdd}>
            <LuImagePlus />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("userPacks.removeChecked")} showArrow>
          <IconButton
            aria-label={t("userPacks.removeChecked")}
            size="xs"
            variant="ghost"
            disabled={checked.size === 0}
            onClick={onRemoveChecked}
          >
            <LuTrash2 />
          </IconButton>
        </Tooltip>
      </HStack>
      <Box flex={maxH ? "none" : "1"} minH="0" maxH={maxH} overflowY="auto">
        {drafts.map((d) => {
          const p = previews.get(d.source)
          const ok = isPreview(p)
          const size = ok ? targetSize(p.width, p.height, d.adjust, p.bounds) : null
          const partCount = Object.keys(d.parts).length
          return (
            <Flex
              key={d.key}
              align="center"
              gap="2.5"
              px="3"
              py="1.5"
              cursor="pointer"
              bg={
                focused === d.key
                  ? "panel.rowSelected"
                  : checked.has(d.key)
                    ? "panel.rowHover"
                    : "transparent"
              }
              _hover={{ bg: focused === d.key ? "panel.rowSelected" : "panel.rowHover" }}
              onClick={(e) => onRowClick(d.key, e.ctrlKey || e.metaKey || e.shiftKey)}
            >
              <Box onClick={(e) => e.stopPropagation()} display="flex">
                <Checkbox.Root
                  size="sm"
                  colorPalette="brand"
                  checked={checked.has(d.key)}
                  onCheckedChange={() => onToggle(d.key)}
                  aria-label={d.name}
                >
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                </Checkbox.Root>
              </Box>
              <Flex
                boxSize="40px"
                flexShrink={0}
                align="center"
                justify="center"
                borderRadius="md"
                bg="black/30"
                overflow="hidden"
              >
                {ok ? (
                  <img
                    src={thumbUrl(p.path)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                  />
                ) : p ? (
                  <Icon as={LuCircleAlert} color="danger.fg" />
                ) : (
                  <Spinner size="xs" color="fg.muted" />
                )}
              </Flex>
              <Box flex="1" minW="0">
                <Text fontSize="sm" truncate>
                  {d.name}
                </Text>
                <Text fontSize="2xs" color={p && !ok ? "danger.fg" : "fg.muted"} truncate>
                  {p && !ok
                    ? t("userPacks.unreadable")
                    : size
                      ? t("userPacks.cells", { w: cellsOf(size.w), h: cellsOf(size.h) })
                      : t("userPacks.reading")}
                </Text>
              </Box>
              {partCount > 0 && (
                <Tooltip content={t("userPacks.partsCount", { count: partCount })} showArrow>
                  <HStack gap="0.5" color="fg.muted" fontSize="2xs">
                    <LuLayers />
                    <Text>{partCount + 1}</Text>
                  </HStack>
                </Tooltip>
              )}
            </Flex>
          )
        })}
      </Box>
    </Flex>
  )
}
