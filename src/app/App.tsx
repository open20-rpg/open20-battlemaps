import { useEffect, useEffectEvent, useState } from "react"
import { Box, Flex } from "@chakra-ui/react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { MenuBar } from "./MenuBar"
import { StatusBar } from "./StatusBar"
import { STATUS_BAR_HEIGHT } from "../ui/layout"
import { EmptyState } from "./EmptyState"
import { PreferencesDialog } from "./dialogs/PreferencesDialog"
import { AboutDialog } from "./dialogs/AboutDialog"
import { ShortcutsDialog } from "../features/shortcuts/ShortcutsDialog"
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
import { useMapStore } from "../stores/mapStore"
import { useModalStackStore } from "../stores/modalStackStore"
import { registerAppActions } from "../features/shortcuts/appActions"
import { onAppCloseRequested } from "../features/shortcuts/api"
import { actionForKey, currentBindings } from "../features/shortcuts/bindings"
import { pressKey, releaseAll, releaseKey } from "../features/shortcuts/held"
import { runAction } from "../features/map/shortcuts"
import { typingIn } from "../lib/dom"

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
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [newMapOpen, setNewMapOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()

  const { handleSave, handleSaveAs, handleOpen, handleOpenPath, guarded, settleUnsaved } =
    useMapFile()

  // Closing the app with unsaved changes asks to save them first.
  const confirmClose = useEffectEvent(() => settleUnsaved())
  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    onAppCloseRequested(() => confirmClose())
      .then((off) => {
        if (disposed) off()
        else unsubscribe = off
      })
      // Outside the desktop app (plain browser), there's no window to watch.
      .catch(() => undefined)
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  // File shortcuts (new, open, save, export) run the shell's own handlers.
  const runFile = useEffectEvent((id: "newMap" | "open" | "save" | "saveAs" | "export") => {
    if (id === "newMap") guarded(() => setNewMapOpen(true))()
    else if (id === "open") void handleOpen()
    else if (hasMap && id === "save") void handleSave()
    else if (hasMap && id === "saveAs") void handleSaveAs()
    else if (hasMap && id === "export") setExportOpen(true)
  })
  useEffect(
    () =>
      registerAppActions({
        newMap: () => runFile("newMap"),
        open: () => runFile("open"),
        save: () => runFile("save"),
        saveAs: () => runFile("saveAs"),
        export: () => runFile("export"),
      }),
    [],
  )
  // Keys held for hold actions, and the shortcuts that work with no map open
  // (with a map, the editor's own key handler runs them all).
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      pressKey(e.key)
      if (useMapStore.getState().map || typingIn(e.target)) return
      if (useModalStackStore.getState().stack.length > 0) return
      const id = actionForKey(e, currentBindings())
      if (id && runAction(id)) e.preventDefault()
    }
    const onUp = (e: KeyboardEvent) => releaseKey(e.key)
    window.addEventListener("keydown", onDown)
    window.addEventListener("keyup", onUp)
    window.addEventListener("blur", releaseAll)
    return () => {
      window.removeEventListener("keydown", onDown)
      window.removeEventListener("keyup", onUp)
      window.removeEventListener("blur", releaseAll)
    }
  }, [])

  return (
    <Flex direction="column" h="100vh" pb={STATUS_BAR_HEIGHT} bg="app.bg">
      <MenuBar
        assetsOpen={assetsOpen}
        mapOpen={hasMap}
        onToggleAssets={() => setAssetsOpen((v) => !v)}
        onOpenPreferences={() => setPrefsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
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
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
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
