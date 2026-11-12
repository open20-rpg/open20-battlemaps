import { Box, Button, Group, HStack, Slider, Stack, Switch, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Modal } from "../../ui/Modal"
import { useSettingsStore } from "../../stores/settingsStore"

/**
 * App preferences: language, panel translucency (App applies the CSS var)
 * and whether moving the view shows a snapshot (useViewportGestures). Stored in the settings store, never in maps. Shadow looks live in
 * the Settings › Shadows tool.
 */
export function PreferencesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const panelAlpha = useSettingsStore((s) => s.panelAlpha)
  const setPanelAlpha = useSettingsStore((s) => s.setPanelAlpha)
  const snapshotGestures = useSettingsStore((s) => s.snapshotViewGestures)
  const setSnapshotGestures = useSettingsStore((s) => s.setSnapshotViewGestures)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("prefs.title")}
      footer={
        <Button variant="subtle" onClick={onClose}>
          {t("prefs.close")}
        </Button>
      }
    >
      <Stack gap="4" fontSize="sm">
        <Box>
          <Text mb="2" color="fg.muted">
            {t("prefs.language")}
          </Text>
          <Group attached>
            <Button
              size="sm"
              variant={i18n.language.startsWith("es") ? "solid" : "outline"}
              colorPalette="brand"
              onClick={() => i18n.changeLanguage("es")}
            >
              Español
            </Button>
            <Button
              size="sm"
              variant={i18n.language.startsWith("en") ? "solid" : "outline"}
              colorPalette="brand"
              onClick={() => i18n.changeLanguage("en")}
            >
              English
            </Button>
          </Group>
        </Box>
        <Box>
          <Text mb="2" color="fg.muted">
            {t("prefs.panelOpacity")}
          </Text>
          <HStack gap="3">
            <Slider.Root
              flex="1"
              size="sm"
              colorPalette="brand"
              min={30}
              max={100}
              step={1}
              value={[Math.round(panelAlpha * 100)]}
              onValueChange={(e) => setPanelAlpha(e.value[0] / 100)}
            >
              <Slider.Control>
                <Slider.Track>
                  <Slider.Range />
                </Slider.Track>
                <Slider.Thumb index={0}>
                  <Slider.HiddenInput />
                </Slider.Thumb>
              </Slider.Control>
            </Slider.Root>
            <Text w="10" textAlign="right" color="fg.muted">
              {Math.round(panelAlpha * 100)}%
            </Text>
          </HStack>
        </Box>
        <HStack gap="3" justify="space-between">
          <Box>
            <Text>{t("prefs.snapshotGestures")}</Text>
            <Text fontSize="xs" color="fg.muted">
              {t("prefs.snapshotGesturesHint")}
            </Text>
          </Box>
          <Switch.Root
            colorPalette="brand"
            checked={snapshotGestures}
            onCheckedChange={(e) => setSnapshotGestures(e.checked)}
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
        <Text color="fg.muted">{t("prefs.theme")}</Text>
      </Stack>
    </Modal>
  )
}
