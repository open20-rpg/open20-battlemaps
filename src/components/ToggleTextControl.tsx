import type { IconType } from "react-icons"
import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useTools } from "../context/tools"

/**
 * A single button whose label flips with its boolean value (e.g. Allow Light /
 * Block Light, Anchored / Freestanding). Clicking toggles the value, which is
 * stored in the tool's params; falls back to `defaultValue` until toggled.
 */
export function ToggleTextControl({
  toolId,
  paramKey,
  trueLabelKey,
  falseLabelKey,
  icon,
  defaultValue,
}: {
  toolId: string
  paramKey: string
  trueLabelKey: string
  falseLabelKey: string
  icon: IconType
  defaultValue: boolean
}) {
  const { t } = useTranslation()
  const { getToolParams, setToolParams } = useTools()
  const on = (getToolParams(toolId)[paramKey] as boolean | undefined) ?? defaultValue

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
          onClick={() => setToolParams(toolId, { [paramKey]: !on })}
          aria-pressed={on}
        >
          <Icon as={icon} boxSize="4" />
          <Text fontSize="sm">{t(on ? trueLabelKey : falseLabelKey)}</Text>
        </Flex>
      </Flex>
    </Box>
  )
}
