import { useState } from "react"
import { Box, Flex, IconButton, Text } from "@chakra-ui/react"
import {
  LuChevronDown,
  LuImagePlus,
  LuMaximize2,
  LuMinimize2,
  LuRotateCcw,
  LuSearch,
} from "react-icons/lu"
import { startImport } from "../../packs/importFlow"
import { usePickerExpand } from "./pickerExpand"
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
 * assets) with a color. Grows to fill the available panel height; its
 * expand button gives it the whole panel (and the search box), its search
 * button a search floating over the grid.
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
  onDefaultColor,
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
  /** When colored externally: receives a picked asset's default color. */
  onDefaultColor?: (color: string) => void
  onChange: (value: AssetSelection) => void
}) {
  const { t } = useTranslation()
  // Own swatch → recolor by the stored color; else by the external color (or
  // "" = plain thumbnails when there is no color at all).
  const gridColor = showColorSwatch ? value.color : (recolorColor ?? "")
  const expand = usePickerExpand()
  const expanded = expand?.expanded ?? false
  const [searching, setSearching] = useState(false)
  // A search applied: its button stays marked once the box is closed.
  const [query, setQuery] = useState("")
  // Imported images are picked right away (all of them in a multi picker).
  const importImages = () =>
    void startImport({
      category,
      onImported: (ids) => {
        if (ids.length === 0) return
        onChange({ ...value, assets: select === "single" ? ids.slice(0, 1) : ids })
      },
    })

  return (
    <Flex direction="column" flex="1" minH="0">
      <Flex px="3" pt="2" pb="1" align="center" gap="1">
        <Text flex="1" fontSize="xs" color="fg.muted">
          {t(labelKey)}
        </Text>
        <Tooltip content={t("userPacks.importImages")} showArrow>
          <IconButton
            aria-label={t("userPacks.importImages")}
            size="2xs"
            variant="ghost"
            onClick={importImages}
          >
            <LuImagePlus />
          </IconButton>
        </Tooltip>
        {!expanded && (
          <Tooltip content={t("library.search")} showArrow>
            <IconButton
              aria-label={t("library.search")}
              aria-pressed={searching}
              size="2xs"
              variant={searching || query ? "subtle" : "ghost"}
              color={query ? "brand.fg" : undefined}
              onClick={() => setSearching((s) => !s)}
            >
              <LuSearch />
            </IconButton>
          </Tooltip>
        )}
        {expand && (
          <Tooltip content={t(expanded ? "library.collapse" : "library.expand")} showArrow>
            <IconButton
              aria-label={t(expanded ? "library.collapse" : "library.expand")}
              size="2xs"
              variant="ghost"
              onClick={() => {
                setSearching(false)
                expand.toggle()
              }}
            >
              {expanded ? <LuMinimize2 /> : <LuMaximize2 />}
            </IconButton>
          </Tooltip>
        )}
      </Flex>
      <AssetSelector
        browserKey={browserKey}
        category={category}
        color={gridColor}
        select={select}
        selectedIds={value.assets}
        onSelectionChange={(ids, picked) => {
          // A wall or tileset brings its own default color
          // (into the swatch, or into the param that colors this browser).
          const def = picked?.defaultColor ?? undefined
          if (def && !showColorSwatch) onDefaultColor?.(def)
          onChange(
            def && showColorSwatch
              ? { ...value, assets: ids, color: def, defaultColor: def }
              : { ...value, assets: ids },
          )
        }}
        showPreview
        showSearch={expanded}
        floatingSearch={searching}
        onCloseSearch={() => setSearching(false)}
        onQueryChange={setQuery}
        allowNull={allowNull}
        onImport={importImages}
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
