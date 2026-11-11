import { Box, Flex, IconButton, Text } from "@chakra-ui/react"
import { LuChevronDown, LuRotateCcw } from "react-icons/lu"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { useTranslation } from "react-i18next"
import { AssetSelector } from "../../library/AssetSelector"
import { ColorPickerPopover } from "../../../ui/ColorPickerPopover"
import { type AssetCategory } from "../../../lib/categories"
import { type AssetSelection } from "../params"

/** What "restore" sets when the asset has no default color of its own. */
const DEFAULT_ASSET_COLOR = "#ffffff"

/**
 * Asset-picker param: an embedded asset browser (search + grid, same as the
 * Library) plus a color selector below. Lets a tool store a chosen asset (or
 * assets) with a color. Grows to fill the available panel height.
 *
 * The grid color is decided by the caller: `showColorSwatch` renders the own
 * color swatch (and recolors by the stored color); otherwise `recolorColor`
 * (a sibling param's color, or none) recolors the grid with no swatch.
 */
export function AssetPickerControl({
  value,
  browserKey,
  labelKey,
  category,
  select,
  allowNull = false,
  showColorSwatch = true,
  recolorColor,
  onChange,
}: {
  value: AssetSelection
  /** Stable id for the backend's per-browser search cache. */
  browserKey: string
  labelKey: string
  category: AssetCategory
  select: "single" | "multi"
  allowNull?: boolean
  /** Render the own color swatch (edits the stored color). */
  showColorSwatch?: boolean
  /** Externally-driven recolor used when `showColorSwatch` is false. */
  recolorColor?: string
  onChange: (value: AssetSelection) => void
}) {
  const { t } = useTranslation()
  // Own swatch → recolor by the stored color; else by the external color (or
  // "" = plain thumbnails when there is no color at all).
  const gridColor = showColorSwatch ? value.color : (recolorColor ?? "")

  return (
    <Flex direction="column" flex="1" minH="0">
      <Text px="3" pt="3" pb="2" fontSize="xs" color="fg.muted">
        {t(labelKey)}
      </Text>
      <AssetSelector
        browserKey={browserKey}
        category={category}
        color={gridColor}
        select={select}
        selectedIds={value.assets}
        onSelectionChange={(ids, picked) => {
          // As in Dungeondraft, a wall or tileset brings its own default color.
          const def = showColorSwatch ? (picked?.defaultColor ?? undefined) : undefined
          onChange(
            def
              ? { ...value, assets: ids, color: def, defaultColor: def }
              : { ...value, assets: ids },
          )
        }}
        showPreview
        showSearch={false}
        allowNull={allowNull}
      />
      {/* Own color selector below the browser (unless colored externally). */}
      {showColorSwatch && (
        <Flex
          px="3"
          py="2.5"
          gap="2"
          align="center"
          borderTopWidth="1px"
          borderColor="panel.border"
          flexShrink={0}
        >
          <Box flex="1" minW="0">
            <ColorPickerPopover
              value={value.color}
              onCommit={(c) => onChange({ ...value, color: c })}
            >
              <Flex
                as="button"
                w="full"
                h="30px"
                align="center"
                justify="flex-end"
                pr="1.5"
                bg={value.color}
                borderWidth="1px"
                borderColor="panel.border"
                borderRadius="md"
                cursor="pointer"
                overflow="hidden"
                _hover={{ borderColor: "brand.fg" }}
              >
                <Flex
                  align="center"
                  justify="center"
                  boxSize="20px"
                  borderRadius="sm"
                  bg="blackAlpha.500"
                  color="white"
                >
                  <LuChevronDown size={14} />
                </Flex>
              </Flex>
            </ColorPickerPopover>
          </Box>
          <Tooltip content={t("tools.restoreColor")} showArrow>
            <IconButton
              aria-label={t("tools.restoreColor")}
              size="xs"
              variant="ghost"
              onClick={() =>
                onChange({ ...value, color: value.defaultColor ?? DEFAULT_ASSET_COLOR })
              }
            >
              <LuRotateCcw />
            </IconButton>
          </Tooltip>
        </Flex>
      )}
    </Flex>
  )
}
