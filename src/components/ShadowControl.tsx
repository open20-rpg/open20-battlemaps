import { Box, Flex, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useTools } from "../context/tools"

/**
 * Shadow toggle: whether the tool's items cast a shadow. Stored (as a boolean)
 * in the tool's params, falling back to `defaultValue` until the user toggles.
 */
export function ShadowControl({
  toolId,
  defaultValue,
}: {
  toolId: string
  defaultValue: boolean
}) {
  const { t } = useTranslation()
  const { getToolParams, setToolParams } = useTools()
  const checked = (getToolParams(toolId).shadow as boolean | undefined) ?? defaultValue

  return (
    <Box px="3" py="3">
      <Flex align="center" justify="space-between">
        <Text fontSize="xs" color="fg.muted">
          {t("tools.shadow")}
        </Text>
        <Switch.Root
          checked={checked}
          onCheckedChange={(e) => setToolParams(toolId, { shadow: e.checked })}
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
