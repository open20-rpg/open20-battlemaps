import { Box, Flex, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useTools } from "../context/tools"

/**
 * Reusable on/off switch for a boolean tool param. `paramKey` is where the
 * value is stored in the tool's params, `labelKey` its i18n label. Falls back
 * to `defaultValue` until toggled. Used by Shadow, Bevel Corners, etc.
 */
export function SwitchParamControl({
  toolId,
  paramKey,
  labelKey,
  defaultValue,
}: {
  toolId: string
  paramKey: string
  labelKey: string
  defaultValue: boolean
}) {
  const { t } = useTranslation()
  const { getToolParams, setToolParams } = useTools()
  const checked = (getToolParams(toolId)[paramKey] as boolean | undefined) ?? defaultValue

  return (
    <Box px="3" py="3">
      <Flex align="center" justify="space-between">
        <Text fontSize="xs" color="fg.muted">
          {t(labelKey)}
        </Text>
        <Switch.Root
          checked={checked}
          onCheckedChange={(e) => setToolParams(toolId, { [paramKey]: e.checked })}
        >
          <Switch.HiddenInput />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Root>
      </Flex>
    </Box>
  )
}
