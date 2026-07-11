import { useEffect, useState } from "react"
import { Box, Flex } from "@chakra-ui/react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useTranslation } from "react-i18next"
import { MenuBar } from "./MenuBar"
import { StatusBar, STATUS_BAR_HEIGHT } from "./StatusBar"
import { EmptyState } from "./EmptyState"
import { PreferencesDialog } from "./dialogs/PreferencesDialog"
import { AboutDialog } from "./dialogs/AboutDialog"
import { AssetsManager } from "../features/packs/AssetsManager"
import { NewMapDialog } from "../features/map/NewMapDialog"
import { MapEditor } from "../features/map/MapEditor"
import { closeMap, createMap } from "../features/map/commands"
import { ToolsPanel } from "../features/tools/ToolsPanel"
import { LibraryPanel } from "../features/library"
import { Toaster, toaster } from "../ui/chakra/toaster"
import { useHasMap } from "../stores/mapStore"
import { useActiveTool, useToolsStore } from "../stores/toolsStore"
import { useSettingsStore } from "../stores/settingsStore"

export default function App() {
  const { t } = useTranslation()
  const hasMap = useHasMap()
  const resetTools = useToolsStore((s) => s.reset)
  const activeTool = useActiveTool()
  const libraryCategory = hasMap ? activeTool?.library : undefined

  // Clear the tool selection whenever the map is closed.
  useEffect(() => {
    if (!hasMap) resetTools()
  }, [hasMap, resetTools])

  // Reflect the persisted panel translucency in the CSS var the panels read.
  const panelAlpha = useSettingsStore((s) => s.panelAlpha)
  useEffect(() => {
    document.documentElement.style.setProperty("--panel-alpha", String(panelAlpha))
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
        {hasMap ? <MapEditor /> : <EmptyState onOpenAssets={() => setAssetsOpen(true)} />}

        {hasMap && <ToolsPanel />}
        {libraryCategory && <LibraryPanel category={libraryCategory} />}

        {assetsOpen && <AssetsManager onClose={() => setAssetsOpen(false)} />}
      </Box>

      <NewMapDialog
        open={newMapOpen}
        onOpenChange={setNewMapOpen}
        onCreate={createMap}
        onOpenAssets={() => setAssetsOpen(true)}
      />

      <StatusBar />

      <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <Toaster />
    </Flex>
  )
}
