import { Icon, IconButton } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuCircleArrowUp } from "react-icons/lu"
import { Tooltip } from "../../ui/chakra/tooltip"
import { openOpen20Page } from "./api"
import { useNewVersion } from "./useUpdateCheck"

/**
 * Beside the version in the status bar, only when a newer one is out: just
 * an icon (the version shows on hover), a link to Battle Maps' page on
 * open20.app, where it's downloaded.
 */
export function UpdateNotice() {
  const { t } = useTranslation()
  const version = useNewVersion()
  if (!version) return null
  const label = t("update.available", { version })
  return (
    <Tooltip content={label} showArrow>
      <IconButton
        aria-label={label}
        size="2xs"
        variant="ghost"
        ml="1"
        minW="5"
        h="5"
        color="brand.fg"
        onClick={() => void openOpen20Page("battle-maps")}
      >
        <Icon as={LuCircleArrowUp} boxSize="3.5" />
      </IconButton>
    </Tooltip>
  )
}
