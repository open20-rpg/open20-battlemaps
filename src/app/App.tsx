import { useEffect, useEffectEvent, useState } from "react"
import { Box, Flex } from "@chakra-ui/react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { MenuBar } from "./MenuBar"
import { StatusBar, STATUS_BAR_HEIGHT } from "./StatusBar"
import { EmptyState } from "./EmptyState"
import { PreferencesDialog } from "./dialogs/PreferencesDialog"
import { AboutDialog } from "./dialogs/AboutDialog"
import { RecentMapsDialog } from "./dialogs/RecentMapsDialog"
import { ExportDialog } from "../features/map/ExportDialog"
import { AssetsManager } from "../features/packs/AssetsManager"
import { NewMapDialog } from "../features/map/NewMapDialog"
import { MapEditor } from "../features/map/MapEditor"
import { closeMap, createMap, redo, undo } from "../features/map/commands"
import { useMapFile } from "../features/map/useMapFile"
import { ToolsPanel } from "../features/tools/ToolsPanel"
import { LibraryPanel } from "../features/library/LibraryPanel"
import { Toaster } from "../ui/chakra/toaster"
import { useCanRedo, useCanUndo, useHasMap } from "../stores/mapStore"
import { useActiveTool, useToolsStore } from "../stores/toolsStore"
import { useSettingsStore } from "../stores/settingsStore"

export default function App() {
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
  const [recentOpen, setRecentOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()

  const { handleSave, handleSaveAs, handleOpen, handleOpenPath, guarded } = useMapFile()

  // Ctrl/Cmd+S saves (the rest of the editor shortcuts live in the canvas).
  const onSaveShortcut = useEffectEvent((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && hasMap) {
      e.preventDefault()
      void (e.shiftKey ? handleSaveAs() : handleSave())
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onSaveShortcut(e)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <Flex direction="column" h="100vh" pb={STATUS_BAR_HEIGHT} bg="app.bg">
      <MenuBar
        assetsOpen={assetsOpen}
        mapOpen={hasMap}
        onToggleAssets={() => setAssetsOpen((v) => !v)}
        onOpenPreferences={() => setPrefsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenRecent={() => setRecentOpen(true)}
        onExit={() => getCurrentWindow().close()}
        onNew={guarded(() => setNewMapOpen(true))}
        onOpen={handleOpen}
        onCloseMap={guarded(closeMap)}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onExport={() => setExportOpen(true)}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
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
      <RecentMapsDialog
        open={recentOpen}
        onClose={() => setRecentOpen(false)}
        onOpen={handleOpenPath}
      />
      {exportOpen && <ExportDialog open onClose={() => setExportOpen(false)} />}

      <Toaster />
    </Flex>
  )
}
