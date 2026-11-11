import { Box, Button, Icon } from "@chakra-ui/react"
import { type IconType } from "react-icons"
import { useTranslation } from "react-i18next"

/**
 * A command button param (Text's Delete, Reference Image's Load…). What it
 * does is the tool behavior's business: the wiring passes `onClick` and
 * whether it's currently `disabled`.
 */
export function ButtonControl({
  labelKey,
  icon,
  colorPalette,
  disabled = false,
  binding,
  onClick,
}: {
  labelKey: string
  /** Its keyboard shortcut, shown after the label. */
  binding?: string
  icon: IconType
  colorPalette?: string
  disabled?: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  return (
    <Box px="3" py="1.5">
      <Button
        size="sm"
        variant="subtle"
        colorPalette={colorPalette}
        disabled={disabled}
        width="full"
        onClick={onClick}
      >
        <Icon as={icon} />
        {binding ? `${t(labelKey)} (${binding})` : t(labelKey)}
      </Button>
    </Box>
  )
}
