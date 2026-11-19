import { Box, Button, Group, HStack, Slider, Stack, Tabs, Text } from "@chakra-ui/react"
import { LuSettings } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import { FloatingWindow } from "../../../ui/FloatingWindow"
import { useSettingsStore } from "../../../stores/settingsStore"
import { PerformanceTab } from "./PerformanceTab"
import { DebugTab } from "./DebugTab"
import { StorageTab } from "./StorageTab"

/**
 * App preferences: language and panel translucency (App applies the CSS
 * var), and how the map renders on this device (Performance tab). Stored in
 * the settings store, never in maps. Shadow looks live in the Settings ›
 * Shadows tool.
 */
export function PreferencesDialog({
  open,
  initialTab = "general",
  onClose,
}: {
  open: boolean
  /** The tab it opens on (general, performance, storage, debug). */
  initialTab?: string
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const panelAlpha = useSettingsStore((s) => s.panelAlpha)
  const setPanelAlpha = useSettingsStore((s) => s.setPanelAlpha)
  if (!open) return null

  // A floating panel of its own size (not a dialog fitted to each tab):
  // switching tabs never resizes it, the tab's content scrolls inside.
  return (
    <FloatingWindow
      title={t("prefs.title")}
      icon={LuSettings}
      onClose={onClose}
      initialSize={{ w: 600, h: 680 }}
      minSize={{ w: 340, h: 320 }}
      resizable
    >
      <Tabs.Root
        defaultValue={initialTab}
        variant="line"
        colorPalette="brand"
        size="sm"
        // Each tab mounts when first shown: Storage measures the disk then.
        lazyMount
        display="flex"
        flexDirection="column"
        flex="1"
        minH="0"
      >
        <Tabs.List px="3" flexShrink={0} overflowX="auto">
          <Tabs.Trigger value="general">{t("prefs.tabGeneral")}</Tabs.Trigger>
          <Tabs.Trigger value="performance">{t("prefs.tabPerformance")}</Tabs.Trigger>
          <Tabs.Trigger value="storage">{t("prefs.tabStorage")}</Tabs.Trigger>
          <Tabs.Trigger value="debug">{t("prefs.tabDebug")}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="general" flex="1" minH="0" overflowY="auto" p="4">
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
            <Text color="fg.muted">{t("prefs.theme")}</Text>
          </Stack>
        </Tabs.Content>
        <Tabs.Content value="performance" flex="1" minH="0" overflowY="auto" p="4">
          <PerformanceTab />
        </Tabs.Content>
        <Tabs.Content value="storage" flex="1" minH="0" overflowY="auto" p="4">
          <StorageTab />
        </Tabs.Content>
        <Tabs.Content value="debug" flex="1" minH="0" overflowY="auto" p="4">
          <DebugTab />
        </Tabs.Content>
      </Tabs.Root>
    </FloatingWindow>
  )
}
