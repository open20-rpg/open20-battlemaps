import { Button, HStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import type { IconType } from "react-icons"
import { SiDiscord, SiKofi, SiPatreon } from "react-icons/si"
import { openOpen20Page, type Open20Page } from "./api"

const ALL_LINKS: readonly { page: Open20Page; icon: IconType; labelKey: string }[] = [
  { page: "discord", icon: SiDiscord, labelKey: "community.discord" },
  { page: "patreon", icon: SiPatreon, labelKey: "community.patreon" },
  { page: "kofi", icon: SiKofi, labelKey: "community.kofi" },
]

/** Store builds leave out the support links: stores don't allow outside payments. */
const LINKS = __STORE_BUILD__ ? ALL_LINKS.filter((l) => l.page === "discord") : ALL_LINKS

/** Open20's community and support, as quiet links (the start screen's foot). */
export function CommunityLinks() {
  const { t } = useTranslation()
  return (
    <HStack gap="1" justify="center" wrap="wrap">
      {LINKS.map(({ page, icon: Icon, labelKey }) => (
        <Button
          key={page}
          size="xs"
          variant="ghost"
          color="fg.muted"
          _hover={{ color: "fg" }}
          onClick={() => void openOpen20Page(page)}
        >
          <Icon />
          {t(labelKey)}
        </Button>
      ))}
    </HStack>
  )
}
