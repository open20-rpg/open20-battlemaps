import { Box, Image } from "@chakra-ui/react"
import mapCover from "../../assets/map-placeholder.png"
import { useActiveTool, useToolsStore } from "../../stores/toolsStore"
import { getToolBehavior } from "../tools/behaviors"

/**
 * The map editor viewport. For now it only shows a placeholder cover image;
 * the real canvas/rendering will replace this later. It already dispatches to
 * the active tool's behavior (the registry in features/tools/behaviors) —
 * today just the cursor, later the pointer events.
 */
export function MapEditor() {
  const activeTool = useActiveTool()
  const params = useToolsStore((s) => (activeTool ? s.paramsByTool[activeTool.id] : undefined))
  const cursor = activeTool ? getToolBehavior(activeTool.id)?.cursor?.(params ?? {}) : undefined

  return (
    <Box position="absolute" inset="0" bg="app.bg" cursor={cursor}>
      <Image src={mapCover} alt="" draggable={false} w="100%" h="100%" objectFit="cover" />
    </Box>
  )
}
