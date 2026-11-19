import { Button, Flex, Icon, Spinner, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuImagePlus, LuPackageOpen } from "react-icons/lu"

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
      <Icon as={LuPackageOpen} boxSize="7" color="fg.subtle" />
      <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
        {searched ? t("library.noMatches") : t("library.empty")}
      </Text>
      {!searched && (
        <Text fontSize="xs" color="fg.subtle" maxW="240px">
          {hint ?? t("library.emptyHint")}
        </Text>
      )}
      {onImport && (
        <Button size="xs" mt="1" colorPalette="brand" variant="subtle" onClick={onImport}>
          <LuImagePlus />
          {t("userPacks.importImages")}
        </Button>
      )}
    </Flex>
  )
}
