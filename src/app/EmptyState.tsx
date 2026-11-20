import { Box, Button, Flex, Stack, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuFolderOpen, LuSquarePen } from "react-icons/lu"
import { BrandMark } from "./BrandMark"
import { useIsPhone } from "../ui/useIsPhone"
import { EssentialsPrompt } from "../features/packs/EssentialsPrompt"
import { useEssentialsMissing } from "../features/packs/useEssentials"
import { UpdatesAvailable } from "../features/open20/UpdatesAvailable"
import { CommunityLinks } from "../features/open20/CommunityLinks"

/**
 * Shown in place of the editor while no map is open: making a map is the
 * thing to do (opening one, the alternative). Below, only when it applies,
 * the free asset pack and what's new; community links at the foot. On a
 * phone the buttons span the width, easy to reach with a thumb.
 */
export function EmptyState({ onNew, onOpen }: { onNew: () => void; onOpen: () => void }) {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const noEssentials = useEssentialsMissing()
  return (
    <Flex
      direction="column"
      h="full"
      overflowY="auto"
      px="4"
      textAlign="center"
      color="fg.muted"
      css={{
        backgroundImage:
          "linear-gradient(#1c1c20 1px, transparent 1px), linear-gradient(90deg, #1c1c20 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }}
    >
      <Flex flex="1" direction="column" align="center" justify="center" gap="6" py="8">
        <VStack gap="2">
          <BrandMark variant="battleMaps" boxSize={phone ? "16" : "20"} color="fg" />
          <Text fontSize="xl" fontWeight="semibold" color="fg">
            {t("canvas.title")}
          </Text>
          <Text fontSize="sm">{t("canvas.subtitle")}</Text>
        </VStack>
        <Stack direction={phone ? "column" : "row"} gap="2" w={phone ? "full" : "auto"} maxW="sm">
          <Button size={phone ? "lg" : "md"} colorPalette="brand" onClick={onNew}>
            <LuSquarePen />
            {t("canvas.newMap")}
          </Button>
          <Button size={phone ? "lg" : "md"} variant="subtle" onClick={onOpen}>
            <LuFolderOpen />
            {t("canvas.openMap")}
          </Button>
        </Stack>
        {noEssentials && <EssentialsPrompt />}
        <UpdatesAvailable />
      </Flex>
      {/* Community and support, at the foot: out of the way of the main actions. */}
      <Box flexShrink={0} pb="4">
        <CommunityLinks />
      </Box>
    </Flex>
  )
}
