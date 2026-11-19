import { Box, Button, HStack, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { useSettingsStore } from "../stores/settingsStore"
import { useGraphicsBenchmark } from "../features/map/benchmark/useGraphicsBenchmark"
import { PRESET_SETTINGS, presetOf } from "../lib/renderPerformance"
import { STATUS_BAR_HEIGHT } from "../ui/layout"

/**
 * First launch: the graphics level the app starts with, and how to change
 * it — by hand (Settings › Performance) or automatically (the app measures
 * this device and applies the preset closest to 60 frames per second).
 * Shown until answered; it doesn't block the app meanwhile.
 */
export function GraphicsIntro({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation()
  const seen = useSettingsStore((s) => s.graphicsIntroSeen)
  const setSeen = useSettingsStore((s) => s.setGraphicsIntroSeen)
  const preset = useSettingsStore((s) => presetOf(s.performance))
  const replacePerformance = useSettingsStore((s) => s.replacePerformance)
  const { running, results, suggested, failed, run } = useGraphicsBenchmark()
  if (seen) return null

  const level = preset ? t(`perf.presets.${preset}`) : t("perf.customPreset")
  const auto = async () => {
    const best = await run()
    if (best) replacePerformance(PRESET_SETTINGS[best])
  }
  const done = !running && suggested !== null
  const fps = results.find((r) => r.preset === suggested)?.fps ?? 0

  return (
    <Box
      position="fixed"
      left="50%"
      transform="translateX(-50%)"
      bottom={`calc(${STATUS_BAR_HEIGHT} + 12px)`}
      zIndex="toast"
      w="min(440px, calc(100vw - 32px))"
      bg="panel.solid"
      borderWidth="1px"
      borderColor="panel.border"
      borderRadius="lg"
      boxShadow="lg"
      p="4"
      fontSize="sm"
    >
      <Stack gap="3">
        <Text fontWeight="semibold">{t("graphicsIntro.title", { level })}</Text>
        <Text color="fg.muted">
          {done
            ? t("graphicsIntro.applied", {
                level: t(`perf.presets.${suggested}`),
                fps: Math.round(fps),
              })
            : running
              ? t("graphicsIntro.running", {
                  tested: results.map((r) => t(`perf.presets.${r.preset}`)).join(", ") || "…",
                })
              : t(failed ? "perf.auto.failed" : "graphicsIntro.body", { level })}
        </Text>
        <HStack gap="2" justify="flex-end" wrap="wrap">
          {done ? (
            <Button size="sm" colorPalette="brand" onClick={() => setSeen(true)}>
              {t("graphicsIntro.close")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" disabled={running} onClick={() => setSeen(true)}>
                {t("graphicsIntro.later")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={running}
                onClick={() => {
                  setSeen(true)
                  onOpenSettings()
                }}
              >
                {t("graphicsIntro.manual")}
              </Button>
              <Button size="sm" colorPalette="brand" loading={running} onClick={() => void auto()}>
                {t("graphicsIntro.auto")}
              </Button>
            </>
          )}
        </HStack>
      </Stack>
    </Box>
  )
}
