import { useState } from "react"
import { Flex, Icon, Tabs, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuLibrary } from "react-icons/lu"
import { AssetSelector } from "./AssetSelector"
import { useTools } from "../context/tools"
import { DEFAULT_CUSTOM_COLOR } from "../lib/colors"

// -- the sticky Library panel --------------------------------------------------

export function LibraryPanel({ category }: { category: string }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState("all")

  // Colorable items are shown recolored with the active tool's custom color.
  const { activeToolId, getToolParams } = useTools()
  const color = (getToolParams(activeToolId ?? "").customColor as string) || DEFAULT_CUSTOM_COLOR

  return (
    <Flex
      position="absolute"
      right="0"
      top="0"
      bottom="0"
      zIndex="docked"
      w="332px"
      maxW="80%"
      direction="column"
      bg="panel.bg"
      borderLeftWidth="1px"
      borderColor="panel.border"
    >
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2.5"
        bg="panel.header"
        borderBottomWidth="1px"
        borderColor="panel.border"
        flexShrink={0}
      >
        <Icon as={LuLibrary} color="brand.fg" boxSize="4" />
        <Text fontWeight="bold" fontSize="sm">
          {t("library.title")}
        </Text>
      </Flex>

      <Tabs.Root
        value={tab}
        onValueChange={(e) => setTab(e.value)}
        variant="line"
        size="sm"
        display="flex"
        flexDirection="column"
        flex="1"
        minH="0"
      >
        <Tabs.List flexShrink={0} px="2">
          <Tabs.Trigger value="all">{t("library.tabAll")}</Tabs.Trigger>
          <Tabs.Trigger value="used">{t("library.tabUsed")}</Tabs.Trigger>
          <Tabs.Trigger value="tags">{t("library.tabTags")}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="all" flex="1" minH="0" p="0" display="flex" flexDirection="column">
          <AssetSelector
            browserKey={`library:${category}`}
            category={category}
            color={color}
            showPreview
          />
        </Tabs.Content>
        <Tabs.Content value="used" flex="1" minH="0">
          <Flex h="full" align="center" justify="center" color="fg.muted" fontSize="sm">
            {t("library.comingSoon")}
          </Flex>
        </Tabs.Content>
        <Tabs.Content value="tags" flex="1" minH="0">
          <Flex h="full" align="center" justify="center" color="fg.muted" fontSize="sm">
            {t("library.comingSoon")}
          </Flex>
        </Tabs.Content>
      </Tabs.Root>
    </Flex>
  )
}
