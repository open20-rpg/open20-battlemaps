import { Button, HStack, Image, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuDownload } from "react-icons/lu"
import preview from "../../assets/essentials-preview.webp"
import { openOpen20Page } from "../open20/api"

/**
 * Invites to get Open20 Essentials while it isn't installed: a glimpse of
 * it, one line and a download (its page on open20.app; the file is then
 * installed from Assets). `compact` fits inside an empty asset grid.
 */
export function EssentialsPrompt({
  compact = false,
  onOpenAssets,
}: {
  compact?: boolean
  /** Shows "Install" (opens the Assets window) beside the download. */
  onOpenAssets?: () => void
}) {
  const { t } = useTranslation()
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
  return (
    <VStack gap="2" w="full" maxW="340px">
      <Image
        src={preview}
        alt=""
        w="full"
        maxW="320px"
        borderRadius="lg"
        borderWidth="1px"
        borderColor="panel.border"
        draggable={false}
      />
      <Text fontWeight="semibold" color="fg">
        {t("essentials.name")}
      </Text>
      <Text fontSize="sm" color="fg.muted">
        {t("essentials.tagline")}
      </Text>
      <HStack gap="2" mt="1">
        <Button size="sm" colorPalette="brand" onClick={download}>
          <LuDownload />
          {t("essentials.download")}
        </Button>
        {onOpenAssets && (
          <Button size="sm" variant="ghost" onClick={onOpenAssets}>
            {t("essentials.install")}
          </Button>
        )}
      </HStack>
    </VStack>
  )
}
