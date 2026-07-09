import { Box, Flex, Text } from "@chakra-ui/react"
import { LuChevronDown } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import { AssetSelector } from "./AssetSelector"
import { ColorPickerPopover } from "./ColorPickerPopover"
import { useTools } from "../context/tools"

interface AssetPickerValue {
  assets: string[]
  color: string
}

/**
 * Asset-picker param: an embedded asset browser (search + grid, same as the
 * Library) plus a color selector below. Lets a tool store a chosen asset (or
 * assets) with a color. Grows to fill the available panel height.
 */
export function AssetPickerControl({
  toolId,
  paramKey,
  labelKey,
  category,
  select,
  defaultColor,
}: {
  toolId: string
  paramKey: string
  labelKey: string
  category: string
  select: "single" | "multi"
  defaultColor: string
}) {
  const { t } = useTranslation()
  const { getToolParams, setToolParams } = useTools()
  const stored = getToolParams(toolId)[paramKey] as AssetPickerValue | undefined
  const assets = stored?.assets ?? []
  const color = stored?.color ?? defaultColor

  const setValue = (patch: Partial<AssetPickerValue>) =>
    setToolParams(toolId, { [paramKey]: { assets, color, ...patch } })

  return (
    <Flex direction="column" flex="1" minH="0">
      <Text px="3" pt="3" pb="2" fontSize="xs" color="fg.muted">
        {t(labelKey)}
      </Text>
      <AssetSelector
        browserKey={`param:${toolId}:${paramKey}`}
        category={category}
        color={color}
        select={select}
        selectedIds={assets}
        onSelectionChange={(ids) => setValue({ assets: ids })}
        showPreview
      />
      {/* Color selector below the browser. */}
      <Box px="3" py="2.5" borderTopWidth="1px" borderColor="panel.border" flexShrink={0}>
        <ColorPickerPopover value={color} onCommit={(c) => setValue({ color: c })}>
          <Flex
            as="button"
            w="full"
            h="30px"
            align="center"
            justify="flex-end"
            pr="1.5"
            bg={color}
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
