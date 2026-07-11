import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { LuSpline } from "react-icons/lu"
import { useTranslation } from "react-i18next"

/**
 * Edit Points toggle: a single button (styled like the Sorting toggle) that is
 * highlighted when on and normal when off. Any exclusivity with other params
 * (e.g. shape) is handled by the tool's normalizeParams.
 */
export function EditPointsControl({
  value,
  onChange,
}: {
  value: boolean
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
          color={value ? "brand.fg" : "menubar.fg"}
          bg={value ? "panel.rowSelected" : "transparent"}
          _hover={{ bg: value ? "panel.rowSelected" : "panel.rowHover" }}
          onClick={() => onChange(!value)}
          aria-pressed={value}
        >
          <Icon as={LuSpline} boxSize="4" />
          <Text fontSize="sm">{t("tools.editPoints")}</Text>
        </Flex>
      </Flex>
    </Box>
  )
}
