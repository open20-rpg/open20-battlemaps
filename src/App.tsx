import { useEffect, useState } from "react"
import { Box, Button, Flex, Group, HStack, Icon, Slider, Stack, Text } from "@chakra-ui/react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Trans, useTranslation } from "react-i18next"
import { LuGem, LuMap } from "react-icons/lu"
import { MenuBar } from "./components/MenuBar"
import { AssetsManager } from "./components/AssetsManager"
import { NewMapDialog } from "./components/NewMapDialog"
import { ToolsPanel } from "./components/ToolsPanel"
import { LibraryPanel } from "./components/LibraryPanel"
import { MapEditor } from "./components/MapEditor"
import { Modal } from "./components/Modal"
import { StatusBar, STATUS_BAR_HEIGHT } from "./components/StatusBar"
import { Toaster, toaster } from "./components/ui/toaster"
import { useMap } from "./context/map"
import { useTools } from "./context/tools"

export default function App() {
  const { t, i18n } = useTranslation()
  const { hasMap, createMap, closeMap } = useMap()
  const { reset: resetTools, activeTool } = useTools()
  const libraryCategory = hasMap ? activeTool?.library : undefined

  // Clear the tool selection whenever the map is closed.
  useEffect(() => {
    if (!hasMap) resetTools()
  }, [hasMap, resetTools])

  // Panel translucency setting (persisted, applied to the --panel-alpha var).
  const [panelAlpha, setPanelAlpha] = useState(() => {
    const saved = Number(localStorage.getItem("opendraft.panel-alpha"))
    return Number.isFinite(saved) && saved > 0 ? saved : 0.5
  })
  useEffect(() => {
    document.documentElement.style.setProperty("--panel-alpha", String(panelAlpha))
    localStorage.setItem("opendraft.panel-alpha", String(panelAlpha))
  }, [panelAlpha])
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [newMapOpen, setNewMapOpen] = useState(false)

  const notImplemented = (label: string) =>
    toaster.create({ title: t("toast.soon", { label }), type: "info" })

  return (
    <Flex direction="column" h="100vh" pb={STATUS_BAR_HEIGHT} bg="app.bg">
      <MenuBar
        assetsOpen={assetsOpen}
        mapOpen={hasMap}
        onToggleAssets={() => setAssetsOpen((v) => !v)}
        onOpenPreferences={() => setPrefsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenRecent={() => toaster.create({ title: t("toast.noRecent"), type: "info" })}
        onExit={() => getCurrentWindow().close()}
        onNew={() => setNewMapOpen(true)}
        onOpen={() => notImplemented(t("toast.openMap"))}
        onCloseMap={closeMap}
        onComingSoon={notImplemented}
      />

      {/* Editor canvas with the sticky tools panel overlaid on the left */}
      <Box flex="1" position="relative" overflow="hidden">
        {hasMap && <MapEditor />}
        {!hasMap && (
        <Flex
          direction="column"
          align="center"
          justify="center"
          h="full"
          color="fg.muted"
          gap="4"
          css={{
            backgroundImage:
              "linear-gradient(#1c1c20 1px, transparent 1px), linear-gradient(90deg, #1c1c20 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        >
          <Icon as={LuMap} boxSize="16" opacity={0.35} />
          <Stack gap="1" align="center">
            <Text fontSize="lg" fontWeight="medium">
              {t("canvas.title")}
            </Text>
            <Text fontSize="sm">
              <Trans i18nKey="canvas.subtitle">
                Creá o abrí un mapa para empezar. Gestioná tus paquetes desde <b>Activos</b>.
              </Trans>
            </Text>
          </Stack>
          <Button variant="subtle" colorPalette="blue" onClick={() => setAssetsOpen(true)}>
            <LuGem />
            {t("canvas.openAssets")}
          </Button>
        </Flex>
        )}

        {hasMap && <ToolsPanel />}
        {libraryCategory && <LibraryPanel category={libraryCategory} />}

        {assetsOpen && <AssetsManager onClose={() => setAssetsOpen(false)} />}
      </Box>

      {/* New map dialog */}
      <NewMapDialog
        open={newMapOpen}
        onOpenChange={setNewMapOpen}
        onCreate={createMap}
        onOpenAssets={() => setAssetsOpen(true)}
      />

      <StatusBar />

      {/* Preferences dialog */}
      <Modal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        title={t("prefs.title")}
        footer={
          <Button variant="subtle" onClick={() => setPrefsOpen(false)}>
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

      {/* About dialog */}
      <Modal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        title={t("about.title")}
        footer={
          <Button variant="subtle" onClick={() => setAboutOpen(false)}>
            {t("prefs.close")}
          </Button>
        }
      >
        <Stack gap="2" color="fg.muted" fontSize="sm">
          <Text color="fg" fontWeight="semibold">
            {t("about.version", { version: __APP_VERSION__ })}
          </Text>
          <Text>{t("about.desc")}</Text>
          <Text>{t("about.compat")}</Text>
        </Stack>
      </Modal>

      <Toaster />
    </Flex>
  )
}
