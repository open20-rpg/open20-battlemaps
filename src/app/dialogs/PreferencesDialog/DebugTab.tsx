import { Box, Flex, Stack, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useSettingsStore } from "../../../stores/settingsStore"

/** Settings › Debug: tools to see what the app is doing (the stats panel). */
export function DebugTab() {
  const { t } = useTranslation()
  const statsPanel = useSettingsStore((s) => s.statsPanel)
  const setStatsPanel = useSettingsStore((s) => s.setStatsPanel)
  return (
    <Stack gap="4" fontSize="sm">
      <Flex gap="3" justify="space-between" align="center">
        <Box>
          <Text>{t("debug.statsPanel")}</Text>
          <Text fontSize="xs" color="fg.muted">
            {t("debug.statsPanelHint")}
          </Text>
        </Box>
        <Switch.Root
          colorPalette="brand"
          checked={statsPanel}
          onCheckedChange={(e) => setStatsPanel(e.checked)}
        >
          <Switch.HiddenInput />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Root>
      </Flex>
    </Stack>
  )
}
