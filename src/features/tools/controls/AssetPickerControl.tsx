import { Box, Flex, Text } from "@chakra-ui/react"
import { LuChevronDown } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import { AssetSelector } from "../../library"
import { ColorPickerPopover } from "../../../ui/ColorPickerPopover"
import { type AssetCategory } from "../../../lib/categories"
import { type AssetSelection } from "../params"

/**
 * Asset-picker param: an embedded asset browser (search + grid, same as the
 * Library) plus a color selector below. Lets a tool store a chosen asset (or
 * assets) with a color. Grows to fill the available panel height.
 */
export function AssetPickerControl({
  value,
  browserKey,
  labelKey,
  category,
  select,
  allowNull = false,
  onChange,
}: {
  value: AssetSelection
  /** Stable id for the backend's per-browser search cache. */
  browserKey: string
  labelKey: string
  category: AssetCategory
  select: "single" | "multi"
  allowNull?: boolean
  onChange: (value: AssetSelection) => void
}) {
  const { t } = useTranslation()

  return (
    <Flex direction="column" flex="1" minH="0">
      <Text px="3" pt="3" pb="2" fontSize="xs" color="fg.muted">
        {t(labelKey)}
      </Text>
      <AssetSelector
        browserKey={browserKey}
        category={category}
        color={value.color}
        select={select}
        selectedIds={value.assets}
        onSelectionChange={(ids) => onChange({ ...value, assets: ids })}
        showPreview
        showSearch={false}
        allowNull={allowNull}
      />
      {/* Color selector below the browser. */}
      <Box px="3" py="2.5" borderTopWidth="1px" borderColor="panel.border" flexShrink={0}>
        <ColorPickerPopover value={value.color} onCommit={(c) => onChange({ ...value, color: c })}>
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
    </Flex>
  )
}
