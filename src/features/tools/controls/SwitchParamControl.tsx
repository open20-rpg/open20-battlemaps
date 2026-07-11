import { Box, Flex, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"

/**
 * Reusable on/off switch for a boolean tool param (Shadow, Bevel Corners, …).
 * `labelKey` comes from the param spec.
 */
export function SwitchParamControl({
  value,
  labelKey,
  onChange,
}: {
  value: boolean
  labelKey: string
  onChange: (value: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <Box px="3" py="1.5">
      <Flex align="center" justify="space-between">
        <Text fontSize="xs" color="fg.muted">
          {t(labelKey)}
        </Text>
        <Switch.Root checked={value} onCheckedChange={(e) => onChange(e.checked)}>
          <Switch.HiddenInput />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Root>
      </Flex>
    </Box>
  )
}
