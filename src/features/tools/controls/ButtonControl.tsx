import { Box, Button, Icon } from "@chakra-ui/react"
import { type IconType } from "react-icons"
import { useTranslation } from "react-i18next"
import { toaster } from "../../../ui/chakra/toaster-instance"

/**
 * A command button param (e.g. Text's Delete). Its action awaits the map/text
 * engine, so for now it only signals "coming soon". `disabled` will later gate
 * it on selection state; it is always enabled today.
 */
export function ButtonControl({
  labelKey,
  icon,
  colorPalette,
  disabled = false,
}: {
  labelKey: string
  icon: IconType
  colorPalette?: string
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const label = t(labelKey)
  return (
    <Box px="3" py="1.5">
      <Button
        size="sm"
        variant="subtle"
        colorPalette={colorPalette}
        disabled={disabled}
        width="full"
        onClick={() => toaster.create({ title: t("toast.soon", { label }), type: "info" })}
      >
        <Icon as={icon} />
        {label}
      </Button>
    </Box>
  )
}
