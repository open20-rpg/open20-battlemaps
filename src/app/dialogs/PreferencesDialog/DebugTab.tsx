import { Box, Flex, Stack, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useSettingsStore } from "../../../stores/settingsStore"

/** Settings › Debug: tools to see what the app is doing (stats panel, graphics detail). */
export function DebugTab() {
  const { t } = useTranslation()
  const statsPanel = useSettingsStore((s) => s.statsPanel)
  const setStatsPanel = useSettingsStore((s) => s.setStatsPanel)
  const graphicsDetail = useSettingsStore((s) => s.graphicsDetail)
  const setGraphicsDetail = useSettingsStore((s) => s.setGraphicsDetail)
  return (
    <Stack gap="4" fontSize="sm">
      <Toggle
        label={t("debug.statsPanel")}
        hint={t("debug.statsPanelHint")}
        checked={statsPanel}
        onChange={setStatsPanel}
      />
      <Toggle
        label={t("debug.graphicsDetail")}
        hint={t("debug.graphicsDetailHint")}
        checked={graphicsDetail}
        onChange={setGraphicsDetail}
      />
    </Stack>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <Flex gap="3" justify="space-between" align="center">
      <Box>
        <Text>{label}</Text>
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      </Box>
      <Switch.Root
        colorPalette="brand"
        checked={checked}
        onCheckedChange={(e) => onChange(e.checked)}
      >
        <Switch.HiddenInput />
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Root>
    </Flex>
  )
}
