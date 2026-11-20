import { useEffect, useEffectEvent, useState } from "react"
import { Box, Flex } from "@chakra-ui/react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { MenuBar } from "./MenuBar"
import { MobileTopBar } from "./MobileTopBar"
import { useIsPhone } from "../ui/useIsPhone"
import { MobileToolsPanel } from "../features/tools/MobileToolsPanel"
import { StatusBar } from "./StatusBar"
import { STATUS_BAR_HEIGHT } from "../ui/layout"
import { EmptyState } from "./EmptyState"
import { PreferencesDialog } from "./dialogs/PreferencesDialog"
import { GraphicsIntro } from "./GraphicsIntro"
import { AboutDialog } from "./dialogs/AboutDialog"
import { ShortcutsDialog } from "../features/shortcuts/ShortcutsDialog"
import { RecentMapsDialog } from "./dialogs/RecentMapsDialog"
import { ExportDialog } from "../features/map/ExportDialog"
import { AssetsManager } from "../features/packs/AssetsManager"
import { ImportAssetsHost } from "../features/packs/ImportAssets"
import { PackEditorHost } from "../features/packs/PackEditor"
import { NewMapDialog } from "../features/map/NewMapDialog"
import { MapEditor } from "../features/map/MapEditor"
import { closeMap, redo, undo } from "../features/map/commands"
import { newMapFlow } from "../features/map/io"
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
  // Phones get their own layout (the desktop one is left as it is).
  const phone = useIsPhone()

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
  // The Preferences tab to show, or null while it's closed.
  const [prefsTab, setPrefsTab] = useState<string | null>(null)
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

  const TopBar = phone ? MobileTopBar : MenuBar
  return (
    <Flex direction="column" h="100dvh" pb={phone ? "0" : STATUS_BAR_HEIGHT} bg="app.bg">
      <TopBar
        assetsOpen={assetsOpen}
        mapOpen={hasMap}
        onToggleAssets={() => setAssetsOpen((v) => !v)}
        onOpenPreferences={() => setPrefsTab("general")}
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
        {hasMap ? (
          <MapEditor />
        ) : (
          <EmptyState onNew={guarded(() => setNewMapOpen(true))} onOpen={handleOpen} />
        )}

        {hasMap && (phone ? <MobileToolsPanel /> : <ToolsPanel />)}
        {/* On a phone the Library is a tab of the tools' sheet. */}
        {libraryCategory && !phone && <LibraryPanel category={libraryCategory} />}

        {assetsOpen && <AssetsManager onClose={() => setAssetsOpen(false)} />}
        <PackEditorHost />
        <ImportAssetsHost />
      </Box>

      <NewMapDialog
        open={newMapOpen}
        onOpenChange={setNewMapOpen}
        onCreate={newMapFlow}
        onOpenAssets={() => setAssetsOpen(true)}
      />

      <StatusBar />

      <PreferencesDialog
        // Each opening starts on the tab asked for.
        key={prefsTab ?? "closed"}
        open={prefsTab !== null}
        initialTab={prefsTab ?? "general"}
        onClose={() => setPrefsTab(null)}
      />
      <GraphicsIntro onOpenSettings={() => setPrefsTab("performance")} />
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
