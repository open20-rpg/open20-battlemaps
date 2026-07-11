import { Button, Flex, Icon, Stack, Text } from "@chakra-ui/react"
import { Trans, useTranslation } from "react-i18next"
import { LuGem, LuMap } from "react-icons/lu"

/** Shown in place of the editor while no map is open. */
export function EmptyState({ onOpenAssets }: { onOpenAssets: () => void }) {
  const { t } = useTranslation()
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      h="full"
      color="fg.muted"
      gap="4"
      css={{
        backgroundImage:
          "linear-gradient(#1c1c20 1px, transparent 1px), linear-gradient(90deg, #1c1c20 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }}
    >
      <Icon as={LuMap} boxSize="16" opacity={0.35} />
      <Stack gap="1" align="center">
        <Text fontSize="lg" fontWeight="medium">
          {t("canvas.title")}
        </Text>
        <Text fontSize="sm">
          <Trans i18nKey="canvas.subtitle" components={{ b: <b /> }} />
        </Text>
      </Stack>
      <Button variant="subtle" colorPalette="blue" onClick={onOpenAssets}>
        <LuGem />
        {t("canvas.openAssets")}
      </Button>
    </Flex>
  )
}
