import { Box, Button, Group, HStack, Slider, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Modal } from "../../ui/Modal"
import { useSettingsStore } from "../../stores/settingsStore"

/** Language and panel-translucency preferences (App applies the CSS var). */
export function PreferencesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const panelAlpha = useSettingsStore((s) => s.panelAlpha)
  const setPanelAlpha = useSettingsStore((s) => s.setPanelAlpha)

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
              colorPalette="blue"
              onClick={() => i18n.changeLanguage("es")}
            >
              Español
            </Button>
            <Button
              size="sm"
              variant={i18n.language.startsWith("en") ? "solid" : "outline"}
              colorPalette="blue"
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
              colorPalette="blue"
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
        <Text color="fg.muted">{t("prefs.theme")}</Text>
        <Text color="fg.muted">{t("prefs.more")}</Text>
      </Stack>
    </Modal>
  )
}
