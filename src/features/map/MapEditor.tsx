import { useRef } from "react"
import { Box } from "@chakra-ui/react"
import { useActiveTool, useToolsStore } from "../../stores/toolsStore"
import { useSettingsStore } from "../../stores/settingsStore"
import { canvasKey } from "../../lib/renderPerformance"
import { getToolBehavior } from "../tools/behaviors"
import { MapCanvas } from "./render/MapCanvas"
import { TextEditOverlay } from "./TextEditOverlay"
import { StatsPanel } from "./StatsPanel"
import { useToolInput } from "./useToolInput"
import { useExtensionDrop } from "../extensions/ui/useExtensionDrop"
import { useExtensionsStore } from "../../stores/extensionsStore"

/**
 * The map editor viewport: the map canvas (layers + grid overlay) with the
 * active tool's behavior (the registry in features/tools/behaviors) wired to
 * its pointer/keyboard input and cursor.
 */
export function MapEditor() {
  const ref = useRef<HTMLDivElement>(null)
  const activeTool = useActiveTool()
  const params = useToolsStore((s) => (activeTool ? s.paramsByTool[activeTool.id] : undefined))
  // An extension's tool may change its cursor while in use.
  const extensionCursor = useExtensionsStore((s) => s.cursor)
  const toolCursor = activeTool ? getToolBehavior(activeTool.id)?.cursor?.(params ?? {}) : undefined
  const cursor = activeTool?.id.startsWith("ext:") ? (extensionCursor ?? toolCursor) : toolCursor
  useToolInput(ref)
  useExtensionDrop(ref)
  // Performance settings that only a new WebGL context (or freshly loaded
  // textures) can apply recreate the canvas.
  const canvas = useSettingsStore((s) => canvasKey(s.performance))
  const statsPanel = useSettingsStore((s) => s.statsPanel)

  return (
    <Box ref={ref} position="absolute" inset="0" bg="app.bg" cursor={cursor} touchAction="none">
      <MapCanvas key={canvas} />
      <TextEditOverlay containerRef={ref} />
      {statsPanel && <StatsPanel />}
    </Box>
  )
}
