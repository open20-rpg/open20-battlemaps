import { Box, Button, Flex, Image, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuDownload } from "react-icons/lu"
import preview from "../../assets/essentials-preview.webp"
import { useIsPhone } from "../../ui/useIsPhone"
import { openOpen20Page } from "../open20/api"

/**
 * Invites to get Open20 Essentials while it isn't installed: a glimpse of
 * it, one line and a single button to its page on open20.app. `compact`
 * fits inside an empty asset grid; otherwise it's a card (the start screen),
 * side by side on a wide screen and tighter on a phone.
 */
export function EssentialsPrompt({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const download = () => void openOpen20Page("essentials")
  if (compact) {
    return (
      <VStack gap="2" mt="1">
        <Image src={preview} alt="" w="180px" borderRadius="md" draggable={false} />
        <Button size="xs" colorPalette="brand" variant="subtle" onClick={download}>
          <LuDownload />
          {t("essentials.get")}
        </Button>
      </VStack>
    )
  }
  const button = (
    <Button
      size="sm"
      variant="subtle"
      colorPalette="brand"
      flexShrink={0}
      w={phone ? "full" : undefined}
      onClick={download}
    >
      <LuDownload />
      {t("essentials.cta")}
    </Button>
  )
  return (
    <Box
      w="full"
      maxW={phone ? "sm" : "lg"}
      p="3"
      borderWidth="1px"
      borderColor="panel.border"
      borderRadius="lg"
      bg="panel.solid"
      textAlign="left"
    >
      <Flex gap="3" align="center">
        <Image
          src={preview}
          alt=""
          w={phone ? "88px" : "120px"}
          aspectRatio={8 / 5}
          objectFit="cover"
          borderRadius="md"
          flexShrink={0}
          draggable={false}
        />
        <Box flex="1" minW="0">
          <Text fontWeight="semibold" color="fg" fontSize="sm">
            {t("essentials.name")}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {t("essentials.tagline")}
          </Text>
        </Box>
        {!phone && button}
      </Flex>
      {phone && <Box mt="3">{button}</Box>}
    </Box>
  )
}
