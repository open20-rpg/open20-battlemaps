import { Button, Flex, Stack, Text } from "@chakra-ui/react"
import { Trans, useTranslation } from "react-i18next"
import { LuGem } from "react-icons/lu"
import { BrandMark } from "./BrandMark"
import { EssentialsPrompt } from "../features/packs/EssentialsPrompt"
import { useEssentialsMissing } from "../features/packs/useEssentials"
import { UpdatesAvailable } from "../features/open20/UpdatesAvailable"

/** Shown in place of the editor while no map is open. */
export function EmptyState({ onOpenAssets }: { onOpenAssets: () => void }) {
  const { t } = useTranslation()
  const noEssentials = useEssentialsMissing()
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      h="full"
      px="4"
      textAlign="center"
      color="fg.muted"
      gap="4"
      css={{
        backgroundImage:
          "linear-gradient(#1c1c20 1px, transparent 1px), linear-gradient(90deg, #1c1c20 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }}
    >
      <BrandMark variant="battleMaps" boxSize="20" color="fg" />
      <Stack gap="1" align="center">
        <Text fontSize="lg" fontWeight="medium">
          {t("canvas.title")}
        </Text>
        <Text fontSize="sm">
          <Trans i18nKey="canvas.subtitle" components={{ b: <b /> }} />
        </Text>
      </Stack>
      {noEssentials ? (
        <EssentialsPrompt onOpenAssets={onOpenAssets} />
      ) : (
        <Button variant="subtle" colorPalette="brand" onClick={onOpenAssets}>
          <LuGem />
          {t("canvas.openAssets")}
        </Button>
      )}
      <UpdatesAvailable />
    </Flex>
  )
}
