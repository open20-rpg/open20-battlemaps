import { Box, Button, Group, HStack, Slider, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Modal } from "../../ui/Modal"
import { useSettingsStore, type ShadowStyle } from "../../stores/settingsStore"
import { SliderControl } from "../../features/tools/controls/SliderControl"

/** Shadow look sliders, in display order: key, i18n label, range. */
const SHADOW_SLIDERS: {
  key: keyof ShadowStyle
  labelKey: string
  min: number
  max: number
  step: number
}[] = [
  { key: "blur", labelKey: "prefs.shadowBlur", min: 0, max: 0.5, step: 0.01 },
  { key: "offsetX", labelKey: "prefs.shadowOffsetX", min: -0.5, max: 0.5, step: 0.01 },
  { key: "offsetY", labelKey: "prefs.shadowOffsetY", min: -0.5, max: 0.5, step: 0.01 },
  { key: "opacity", labelKey: "prefs.shadowOpacity", min: 0, max: 1, step: 0.05 },
]

/**
 * App preferences: language, panel translucency (App applies the CSS var)
 * and how drop shadows look. Stored in the settings store, never in maps.
 */
export function PreferencesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const panelAlpha = useSettingsStore((s) => s.panelAlpha)
  const setPanelAlpha = useSettingsStore((s) => s.setPanelAlpha)
  const shadowStyle = useSettingsStore((s) => s.shadowStyle)
  const setShadowStyle = useSettingsStore((s) => s.setShadowStyle)
  const resetShadowStyle = useSettingsStore((s) => s.resetShadowStyle)

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
        <Box mx="-3">
          <HStack justify="space-between" px="3" mb="1">
            <Text color="fg.muted">{t("prefs.shadows")}</Text>
            <Button size="2xs" variant="ghost" onClick={resetShadowStyle}>
              {t("prefs.reset")}
            </Button>
          </HStack>
          {SHADOW_SLIDERS.map((s) => (
            <SliderControl
              key={s.key}
              value={shadowStyle[s.key]}
              labelKey={s.labelKey}
              min={s.min}
              max={s.max}
              step={s.step}
              onChange={(v) => setShadowStyle({ [s.key]: v })}
            />
          ))}
        </Box>
        <Text color="fg.muted">{t("prefs.theme")}</Text>
      </Stack>
    </Modal>
  )
}
