import { Button, Flex } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuCircleArrowUp } from "react-icons/lu"
import { openOpen20Page, type Open20Page } from "./api"
import { useNewEssentials, useNewVersion } from "./useUpdateCheck"

/**
 * What's newer than what's here (Battle Maps itself, the installed Open20
 * Essentials): one quiet link each to its page on open20.app. Nothing
 * when all is up to date. `bar` lays them as a strip (the Assets window).
 */
export function UpdatesAvailable({ bar = false }: { bar?: boolean }) {
  const { t } = useTranslation()
  const app = useNewVersion()
  const essentials = useNewEssentials()
  if (!app && !essentials) return null
  const link = (page: Open20Page, label: string) => (
    <Button
      key={page}
      size="xs"
      variant="ghost"
      color="brand.fg"
      onClick={() => void openOpen20Page(page)}
    >
      <LuCircleArrowUp />
      {label}
    </Button>
  )
  return (
    <Flex
      gap="1"
      wrap="wrap"
      justify="center"
      {...(bar
        ? { px: "2", py: "1", borderTopWidth: "1px", borderColor: "panel.border", flexShrink: 0 }
        : {})}
    >
      {app && link("battle-maps", t("update.app", { version: app }))}
      {essentials && link("essentials", t("update.essentials", { version: essentials }))}
    </Flex>
  )
}
