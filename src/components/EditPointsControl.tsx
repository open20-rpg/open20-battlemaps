import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { LuSpline } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import { useTools } from "../context/tools"

/**
 * Edit Points toggle: a single button (styled like the Sorting toggle) that is
 * highlighted when on and normal when off. The boolean is stored in the tool's
 * params, falling back to `defaultValue` until toggled. Any exclusivity with
 * other params (e.g. shape) is handled by the tool's normalizeParams.
 */
export function EditPointsControl({
  toolId,
  defaultValue,
}: {
  toolId: string
  defaultValue: boolean
}) {
  const { t } = useTranslation()
  const { getToolParams, setToolParams } = useTools()
  const active = (getToolParams(toolId).editPoints as boolean | undefined) ?? defaultValue

  return (
    <Box px="3" py="3">
      <Flex borderWidth="1px" borderColor="panel.border" borderRadius="md" overflow="hidden">
        <Flex
          as="button"
          flex="1"
          align="center"
          justify="center"
          gap="1.5"
          py="1.5"
          color={active ? "brand.fg" : "menubar.fg"}
          bg={active ? "panel.rowSelected" : "transparent"}
          _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
          onClick={() => setToolParams(toolId, { editPoints: !active })}
          aria-pressed={active}
        >
          <Icon as={LuSpline} boxSize="4" />
          <Text fontSize="sm">{t("tools.editPoints")}</Text>
        </Flex>
      </Flex>
    </Box>
  )
}
