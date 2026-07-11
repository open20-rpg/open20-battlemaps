import { type IconType } from "react-icons"
import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"

/**
 * A single button whose label flips with its boolean value (e.g. Allow Light /
 * Block Light, Anchored / Freestanding). Clicking toggles the value.
 */
export function ToggleTextControl({
  value,
  trueLabelKey,
  falseLabelKey,
  icon,
  onChange,
}: {
  value: boolean
  trueLabelKey: string
  falseLabelKey: string
  icon: IconType
  onChange: (value: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <Box px="3" py="1.5">
      <Flex borderWidth="1px" borderColor="panel.border" borderRadius="md" overflow="hidden">
        <Flex
          as="button"
          flex="1"
          align="center"
          justify="center"
          gap="1.5"
          py="1.5"
          color="menubar.fg"
          _hover={{ bg: "panel.rowHover" }}
          onClick={() => onChange(!value)}
          aria-pressed={value}
        >
          <Icon as={icon} boxSize="4" />
          <Text fontSize="sm">{t(value ? trueLabelKey : falseLabelKey)}</Text>
        </Flex>
      </Flex>
    </Box>
  )
}
