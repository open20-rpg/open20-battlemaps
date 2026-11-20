import { Button, Flex, Icon, Spinner, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuImagePlus, LuPackageOpen } from "react-icons/lu"
import { EssentialsPrompt } from "../../packs/EssentialsPrompt"
import { useEssentialsMissing } from "../../packs/useEssentials"

/** What an asset grid shows while its first results are on their way. */
export function GridLoading() {
  const { t } = useTranslation()
  return (
    <Flex
      h="full"
      minH="120px"
      direction="column"
      align="center"
      justify="center"
      gap="2.5"
      p="6"
      role="status"
      aria-live="polite"
    >
      <Spinner size="md" color="brand.fg" borderWidth="3px" />
      <Text fontSize="xs" color="fg.muted">
        {t("library.loading")}
      </Text>
    </Flex>
  )
}

/**
 * An asset grid with nothing to show: says so (and why, if searching), and
 * offers to import images when the grid allows it.
 */
export function GridEmpty({
  searched,
  onImport,
  hint,
}: {
  searched: boolean
  onImport?: () => void
  /** What to suggest instead of the default (turn on a pack, or import). */
  hint?: string
}) {
  const { t } = useTranslation()
  const noEssentials = useEssentialsMissing()
  // Nothing installed to pick from: a glimpse of the free pack instead of
  // icon and hint, one download away.
  const essentials = noEssentials && !searched && !hint
  return (
    <Flex
      h="full"
      minH="120px"
      direction="column"
      align="center"
      justify="center"
      gap="2"
      p="6"
      textAlign="center"
    >
      {!essentials && <Icon as={LuPackageOpen} boxSize="7" color="fg.subtle" />}
      <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
        {searched ? t("library.noMatches") : t("library.empty")}
      </Text>
      {!searched && !essentials && (
        <Text fontSize="xs" color="fg.subtle" maxW="240px">
          {hint ?? t("library.emptyHint")}
        </Text>
      )}
      {essentials && <EssentialsPrompt compact />}
      {onImport && (
        <Button
          size="xs"
          mt={essentials ? "0" : "1"}
          colorPalette={essentials ? undefined : "brand"}
          variant={essentials ? "ghost" : "subtle"}
          onClick={onImport}
        >
          <LuImagePlus />
          {t("userPacks.importImages")}
        </Button>
      )}
    </Flex>
  )
}
