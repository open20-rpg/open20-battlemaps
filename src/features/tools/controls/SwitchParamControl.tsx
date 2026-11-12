import { Box, Flex, Icon, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuInfo } from "react-icons/lu"
import { Tooltip } from "../../../ui/chakra/tooltip"

/**
 * Reusable on/off switch for a boolean tool param (Shadow, Bevel Corners, …).
 * `labelKey` (and the optional `tooltipKey`, explained on an info icon)
 * come from the param spec.
 */
export function SwitchParamControl({
  value,
  labelKey,
  tooltipKey,
  onChange,
}: {
  value: boolean
  labelKey: string
  tooltipKey?: string
  onChange: (value: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <Box px="3" py="1.5">
      <Flex align="center" justify="space-between">
        <Flex align="center" gap="1.5" minW="0">
          <Text fontSize="xs" color="fg.muted">
            {t(labelKey)}
          </Text>
          {tooltipKey && (
            <Tooltip content={t(tooltipKey)} openDelay={200} showArrow>
              <Icon
                as={LuInfo}
                boxSize="3.5"
                color="fg.muted"
                tabIndex={0}
                aria-label={t(tooltipKey)}
              />
            </Tooltip>
          )}
        </Flex>
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
