import { Box, Button, Flex, Icon, IconButton, Text } from "@chakra-ui/react"
import { type IconType } from "react-icons"
import { useTranslation } from "react-i18next"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { useIsPhone } from "../../../ui/useIsPhone"

interface ButtonControlProps {
  labelKey: string
  /** Its keyboard shortcut, shown after the label. */
  binding?: string
  icon: IconType
  colorPalette?: string
  disabled?: boolean
  /** One of a packed row of buttons: just its icon (named by a tooltip, or a caption on phones). */
  compact?: boolean
  onClick: () => void
}

/**
 * A command button param (Text's Delete, Reference Image's Load…). What it
 * does is the tool behavior's business: the wiring passes `onClick` and
 * whether it's currently `disabled`.
 */
export function ButtonControl(props: ButtonControlProps) {
  const { t } = useTranslation()
  const { labelKey, binding, icon, colorPalette, disabled = false, onClick } = props
  const label = binding ? `${t(labelKey)} (${binding})` : t(labelKey)
  if (props.compact) return <CompactButton {...props} label={label} />
  return (
    <Box px="3" py="1">
      <Button
        size="xs"
        variant="subtle"
        colorPalette={colorPalette}
        disabled={disabled}
        width="full"
        onClick={onClick}
      >
        <Icon as={icon} />
        {label}
      </Button>
    </Box>
  )
}

function CompactButton({
  label,
  labelKey,
  icon,
  colorPalette,
  disabled = false,
  onClick,
}: ButtonControlProps & { label: string }) {
  const { t } = useTranslation()
  const phone = useIsPhone()
  if (phone) {
    // No hover on a phone to show a tooltip: the name goes under the icon.
    return (
      <Button
        variant="subtle"
        colorPalette={colorPalette}
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        h="auto"
        minW="0"
        px="1"
        py="1.5"
      >
        <Flex direction="column" align="center" gap="0.5" minW="0">
          <Icon as={icon} boxSize="4" />
          <Text
            fontSize="2xs"
            lineHeight="1.15"
            lineClamp={2}
            textAlign="center"
            whiteSpace="normal"
          >
            {t(labelKey)}
          </Text>
        </Flex>
      </Button>
    )
  }
  return (
    <Tooltip content={label} showArrow>
      <IconButton
        aria-label={label}
        size="sm"
        variant="subtle"
        colorPalette={colorPalette}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon as={icon} />
      </IconButton>
    </Tooltip>
  )
}
