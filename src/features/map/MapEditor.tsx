import { Box } from "@chakra-ui/react"
import { useActiveTool, useToolsStore } from "../../stores/toolsStore"
import { getToolBehavior } from "../tools/behaviors"
import { MapCanvas } from "./render/MapCanvas"

/**
 * The map editor viewport: the map canvas (layers + grid overlay), dispatched
 * alongside the active tool's behavior (the registry in
 * features/tools/behaviors) — today just the cursor, later the pointer events.
 */
export function MapEditor() {
  const activeTool = useActiveTool()
  const params = useToolsStore((s) => (activeTool ? s.paramsByTool[activeTool.id] : undefined))
  const cursor = activeTool ? getToolBehavior(activeTool.id)?.cursor?.(params ?? {}) : undefined

  return (
    <Box position="absolute" inset="0" bg="app.bg" cursor={cursor}>
      <MapCanvas />
    </Box>
  )
}
